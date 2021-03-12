/**
 * This project uses tabs instead of spaces to increase accessibility:
 * https://dev.to/alexandersandberg/why-we-should-default-to-tabs-instead-of-spaces-for-an-accessible-first-environment-101f
 */

import { API } from 'homebridge'

import { PLATFORM_NAME, PLUGIN_NAME } from './constants'
import { SecurityFloodlightsPlatform } from './platform'

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SecurityFloodlightsPlatform)
}
