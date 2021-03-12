import {
	API,
	Characteristic,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	PlatformConfig,
	Service,
} from 'homebridge'

import { OccupancySensorAccessory } from './accessories/occupancy-sensor.accessory'
import { SecuritySystemAccessory } from './accessories/security-system.accessory'
import { SwitchAccessory } from './accessories/switch.accessory'
import { PLATFORM_NAME, PLUGIN_NAME, VERSION } from './constants'

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SecurityFloodlightsPlatform implements DynamicPlatformPlugin {
	readonly Service: typeof Service = this.api.hap.Service
	readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic

	// this is used to track restored cached accessories
	readonly accessories = new Set<PlatformAccessory>()

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
		log.debug(`Finished initializing platform (${VERSION})`)
		api.on('didFinishLaunching', () => {
			log.debug('Executed didFinishLaunching callback')
			// For development:
			// this.unregisterAllAccessories()
			this.discoverDevices()
			this.bindAccessoryEvents()
			this.unregisterUnconfiguredDevices()
		})
	}

	/**
	 * This function is invoked when homebridge restores cached accessories from disk at startup.
	 * It should be used to setup event handlers for characteristics and update respective values.
	 */
	configureAccessory(accessory: PlatformAccessory) {
		this.log.debug('Loading accessory from cache:', accessory.displayName)

		// add the restored accessory to the accessories cache so we can track if it has already been registered
		this.accessories.add(accessory)
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
				id: `${id}:occupancy`,
				displayName,
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
		const { log, api } = this
		const accessories = [...this.accessories]

		const uuid = api.hap.uuid.generate(`${PLATFORM_NAME}:${config.id}`)
		const cachedAccessory = accessories.find(({ UUID }) => UUID === uuid)

		if (cachedAccessory) {
			log.debug('Found accessory in cache:', cachedAccessory.displayName)
			this.accessories.delete(cachedAccessory)

			if (cachedAccessory.context.version === VERSION && VERSION !== 'v0.0.0') {
				return new ctor(this, cachedAccessory)
			} else {
				log.debug('Found accessory is outdated; unregistering.')
				this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
					cachedAccessory,
				])
			}
		}

		log.debug('Registering new accessory:', config.displayName)
		const accessory = new api.platformAccessory(config.displayName, uuid)
		accessory.context.device = config
		accessory.context.version = VERSION

		const accessoryHandler = new ctor(this, accessory)
		api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

		return accessoryHandler
	}

	bindAccessoryEvents(): void {
		const { system, windOverrideSwitch, lightGroups } = this

		system.arm$.subscribe(() => {
			for (const { overrideSwitch, occupancySensor } of lightGroups) {
				if (overrideSwitch.isOff && windOverrideSwitch.isOff) {
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
			for (const { occupancySensor } of lightGroups) {
				if (system.isArmed) {
					occupancySensor.isActive = true
				}
			}
		})

		for (const { overrideSwitch, occupancySensor } of lightGroups) {
			overrideSwitch.on$.subscribe(() => {
				occupancySensor.isTampered = true
			})

			overrideSwitch.off$.subscribe(() => {
				occupancySensor.isTampered = false
			})
		}
	}

	private unregisterUnconfiguredDevices() {
		const accessories = [...this.accessories]
		const count = accessories.length

		if (!count) {
			return
		}

		this.log.debug(`Unregistering ${count} unconfigured accessories.`)
		this.api.unregisterPlatformAccessories(
			PLUGIN_NAME,
			PLATFORM_NAME,
			accessories
		)
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
