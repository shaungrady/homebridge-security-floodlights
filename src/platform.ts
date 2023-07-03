import {
	API,
	Characteristic,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	Service,
} from 'homebridge'
import { nanoid } from 'nanoid'

import { OccupancySensorAccessory } from './accessories/occupancy-sensor.accessory'
import { SecuritySystemAccessory } from './accessories/security-system.accessory'
import { SwitchAccessory } from './accessories/switch.accessory'
import { PLATFORM_NAME, PLUGIN_NAME, VERSION } from './constants'
import { AccessoryContext, FloodlightPlatformConfig } from './platform.types'

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SecurityFloodlightsPlatform implements DynamicPlatformPlugin {
	readonly Service: typeof Service = this.api.hap.Service
	readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic
	readonly informationService = new this.api.hap.Service.AccessoryInformation()

	// this is used to track restored cached accessories
	readonly accessories = new Set<PlatformAccessory<AccessoryContext>>()
	// prevent collisions of serial numbers
	readonly serialNumbers = new Set<string>()

	private system!: SecuritySystemAccessory
	private windOverrideSwitch!: SwitchAccessory

	private lightGroups: Array<{
		occupancySensor: OccupancySensorAccessory
		overrideSwitch: SwitchAccessory
	}> = []

	constructor(
		public readonly log: Logger,
		public readonly config: FloodlightPlatformConfig,
		public readonly api: API
	) {
		log.debug(`Initialized platform. (${VERSION})`)

		this.informationService
			.setCharacteristic(
				this.api.hap.Characteristic.Manufacturer,
				'Custom Manufacturer'
			)
			.setCharacteristic(this.api.hap.Characteristic.Model, 'Custom Model')

		if (this.isConfigInvalid(config)) {
			return
		}

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
	 * It should be used to set up event handlers for characteristics and update respective values.
	 */
	configureAccessory(accessory: PlatformAccessory<AccessoryContext>) {
		this.log.debug('Loading accessory from cache:', accessory.displayName)

		// add the restored accessory to the accessories cache so we can track if it has already been registered
		this.accessories.add(accessory)
		this.serialNumbers.add(accessory.context.serialNumber)
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

		for (const groupConfig of this.config?.lightGroups ?? []) {
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
		const { log, api } = this
		const accessories = Array.from(this.accessories)

		const uuid = api.hap.uuid.generate(`${PLATFORM_NAME}:${config.id}`)
		const cachedAccessory = accessories.find(({ UUID }) => UUID === uuid)

		if (cachedAccessory) {
			log.debug(
				'Found accessory in cache:',
				cachedAccessory.displayName,
				`(SN: ${cachedAccessory.context.serialNumber})`
			)
			this.accessories.delete(cachedAccessory)

			if (cachedAccessory.context.version === VERSION) {
				return new ctor(this, cachedAccessory)
			} else {
				log.debug('Found accessory is outdated; unregistering.')
				this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
					cachedAccessory,
				])
			}
		}

		const accessory = new api.platformAccessory(config.displayName, uuid)
		accessory.context.device = config
		accessory.context.version = VERSION
		accessory.context.state = cachedAccessory?.context.state
		accessory.context.serialNumber = cachedAccessory?.context.serialNumber

		while (!accessory.context.serialNumber) {
			const serialNumber = nanoid(13)
			if (!this.serialNumbers.has(serialNumber)) {
				accessory.context.serialNumber = serialNumber
			}
		}

		log.debug(
			!!cachedAccessory
				? 'Re-registering updated accessory:'
				: 'Registering new accessory:',
			config.displayName,
			`(SN: ${accessory.context.serialNumber})`
		)
		const accessoryHandler = new ctor(this, accessory)
		api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

		return accessoryHandler
	}

	bindAccessoryEvents(): void {
		const { system, windOverrideSwitch, lightGroups } = this

		system.arm$.subscribe(() => {
			for (const { occupancySensor, overrideSwitch } of lightGroups) {
				if (overrideSwitch.isOff && windOverrideSwitch.isOff) {
					occupancySensor.isActive = true
				}
			}
		})

		system.disarm$.subscribe(() => {
			for (const { occupancySensor, overrideSwitch } of lightGroups) {
				overrideSwitch.isOn = false
				occupancySensor.isActive = false
			}
		})

		windOverrideSwitch.on$.subscribe(() => {
			for (const { occupancySensor } of lightGroups) {
				occupancySensor.isActive = false

				// Temporarily set occupied to false so HK automations can trigger, allowing
				// the lights to return to their normal "not occupied" state.
				occupancySensor.isOccupied = false
				setTimeout(() => {
					occupancySensor.isOccupied =
						occupancySensor.activeMotionSwitchCount > 0
				}, 2_500)
			}
		})

		windOverrideSwitch.off$.subscribe(() => {
			for (const { occupancySensor } of lightGroups) {
				if (system.isArmed) {
					occupancySensor.isActive = true
				}
			}
		})

		for (const { occupancySensor, overrideSwitch } of lightGroups) {
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

	private isConfigInvalid(config: FloodlightPlatformConfig): boolean {
		const errors = new Set<string>()

		if (!('showWindOverrideSwitch' in config)) {
			errors.add(`Missing config property 'showWindOverrideSwitch'`)
		}

		if (!('lightGroups' in config)) {
			errors.add(`Missing config property 'lightGroups'`)
		} else {
			for (const {
				id,
				displayName,
				motionSensorCount,
				occupancyTimeoutSeconds,
			} of this.config?.lightGroups ?? []) {
				if (typeof id !== 'string') {
					errors.add(`Bad light group property 'id' value: ${id}`)
				}

				if (typeof displayName !== 'string') {
					errors.add(
						`Bad light group property 'displayName' value: ${displayName}`
					)
				}

				if (typeof motionSensorCount !== 'number') {
					errors.add(
						`Bad light group property 'motionSensorCount' value: ${motionSensorCount}`
					)
				}

				if (typeof occupancyTimeoutSeconds !== 'number') {
					errors.add(
						`Bad light group property 'occupancyTimeoutSeconds' value: ${occupancyTimeoutSeconds}`
					)
				}
			}
		}

		for (const error in errors) {
			this.log.error(error)
		}

		return errors.size > 0
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
