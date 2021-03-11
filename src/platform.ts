import {
	API,
	Characteristic,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	PlatformConfig,
	Service,
} from 'homebridge'
import { filter } from 'rxjs/operators'

import { OccupancySensorAccessory } from './accessories/occupancy-sensor.accessory'
import { SecuritySystemAccessory } from './accessories/security-system.accessory'
import { SwitchAccessory } from './accessories/switch.accessory'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings'

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SecurityFloodlightsPlatform implements DynamicPlatformPlugin {
	readonly Service: typeof Service = this.api.hap.Service
	readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic

	// this is used to track restored cached accessories
	readonly accessories: PlatformAccessory[] = []

	private system!: SecuritySystemAccessory
	private windOverrideSwitch!: SwitchAccessory

	private lightGroups: Array<{
		occupancySensor: OccupancySensorAccessory
		overrideSwitch: SwitchAccessory
	}> = []

	constructor(
		public readonly log: Logger,
		public readonly config: PlatformConfig,
		public readonly api: API
	) {
		log.debug('Finished initializing platform')
		api.on('didFinishLaunching', () => {
			log.debug('Executed didFinishLaunching callback')
			this.unregisterAllAccessories()
			this.discoverDevices()
			this.bindAccessoryEvents()
		})
	}

	/**
	 * This function is invoked when homebridge restores cached accessories from disk at startup.
	 * It should be used to setup event handlers for characteristics and update respective values.
	 */
	configureAccessory(accessory: PlatformAccessory) {
		this.log.debug('Loading accessory from cache:', accessory.displayName)
		// add the restored accessory to the accessories cache so we can track if it has already been registered
		this.accessories.push(accessory)
	}

	discoverDevices() {
		this.system = this.getAccessory(SecuritySystemAccessory, {
			id: 'system',
			displayName: 'Security Floodlights',
		})

		this.windOverrideSwitch = this.getAccessory(SwitchAccessory, {
			id: 'windOverride',
			displayName: 'Floodlight Wind Override',
		})

		for (const groupConfig of this.config.lightGroups) {
			const {
				id,
				displayName,
				motionSensorCount,
				occupancyTimeoutSeconds,
			} = groupConfig

			const occupancySensor = this.getAccessory(OccupancySensorAccessory, {
				displayName: `${displayName} Occupancy`,
				id: `${id}:occupancy`,
				motionSensorCount,
				occupancyTimeoutSeconds,
			})

			const overrideSwitch = this.getAccessory(SwitchAccessory, {
				displayName: `${displayName} Floodlight Override`,
				id: `${id}:override`,
			})

			this.lightGroups.push({ occupancySensor, overrideSwitch })
		}
	}

	private getAccessory<T>(
		ctor: AccessoryConstructor<T>,
		config: AccessoryConfig
	): T {
		const { log, api, accessories } = this

		const uuid = api.hap.uuid.generate(`${PLATFORM_NAME}:${config.id}`)
		const cachedAccessory = accessories.find(({ UUID }) => UUID === uuid)

		if (cachedAccessory) {
			log.debug('Found accessory in cache:', cachedAccessory.displayName)
			return new ctor(this, cachedAccessory)
		} else {
			log.debug('Registering new accessory:', config.displayName)
			const accessory = new api.platformAccessory(config.displayName, uuid)
			accessory.context.device = config

			const accessoryHandler = new ctor(this, accessory)
			api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

			return accessoryHandler
		}
	}

	bindAccessoryEvents(): void {
		const { system, windOverrideSwitch, lightGroups } = this

		system.arm$.subscribe(() => {
			for (const { overrideSwitch, occupancySensor } of lightGroups) {
				if (overrideSwitch.isOff) {
					occupancySensor.isActive = true
				}
			}
		})

		system.disarm$.subscribe(() => {
			for (const { overrideSwitch, occupancySensor } of lightGroups) {
				overrideSwitch.isOn = false
				occupancySensor.isActive = false
			}
		})

		windOverrideSwitch.on$.subscribe(() => {
			for (const { occupancySensor } of lightGroups) {
				occupancySensor.isActive = false
			}
		})

		windOverrideSwitch.off$.subscribe(() => {
			for (const { overrideSwitch, occupancySensor } of lightGroups) {
				if (system.isArmed && overrideSwitch.isOff) {
					occupancySensor.isActive = true
				}
			}
		})

		/**
		 * LIGHT GROUP HOMEKIT AUTOMATIONS
		 *
		 * [Turning lights on]
		 *  IF ANY
		 *    Occupancy.Detected = true
		 *    Occupancy.Active = true
		 *  AND ALL
		 *    Occupancy.Tamper = false
		 *    System.State != DISARM
		 *  THEN
		 *    Scene: on
		 *
		 * [Turning lights to dim/off]
		 *  IF ANY
		 *    Occupancy.Detected = false
		 *    Occupancy.Active = false
		 *  AND
		 *    Occupancy.Tamper = false
		 *  THEN
		 *    Shortcut:
		 *      - get System.CurrentState
		 *      - if (state == STAY)
		 *        - Scene: dim
		 *      - else
		 *        - Scene: off
		 */
		for (const { overrideSwitch, occupancySensor } of lightGroups) {
			overrideSwitch.on$.subscribe(() => {
				occupancySensor.isTampered = true
				occupancySensor.isActive = false
			})

			overrideSwitch.off$.subscribe(() => {
				occupancySensor.isTampered = false
				if (system.isArmed && windOverrideSwitch.isOff) {
					occupancySensor.isActive = true
				}
			})
		}
	}

	private unregisterAllAccessories() {
		this.log.debug('Unregistering all accessories.')
		this.api.unregisterPlatformAccessories(
			PLUGIN_NAME,
			PLATFORM_NAME,
			this.accessories
		)
		this.accessories.length = 0
	}
}

interface AccessoryConstructor<T> {
	new (platform: SecurityFloodlightsPlatform, accessory: PlatformAccessory): T
}

interface AccessoryConfig {
	id: string
	displayName: string

	[option: string]: any
}
