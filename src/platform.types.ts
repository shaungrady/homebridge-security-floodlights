import { PlatformConfig } from 'homebridge'
import { PlatformIdentifier, PlatformName } from 'homebridge/lib/api'

export interface FloodlightPlatformConfig extends PlatformConfig {
	showWindOverrideSwitch?: boolean
	lightGroups?: LightGroup[]
}

export interface LightGroup {
	/** Unique ID that ties HomeKit automations to this groups devices. */
	id: string
	/** Name to display in HomeKit */
	displayName: string
	/** Number of motion sensor switches that can trigger occupancy */
	motionSensorCount: number
	/** Number of seconds it takes before occupancy sensors changes to inactive */
	occupancyTimeoutSeconds: number
}
