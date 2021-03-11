import { API } from 'homebridge'

import { PLATFORM_NAME, PLUGIN_NAME } from './constants'
import { SecurityFloodlightsPlatform } from './platform'

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
	console.log('Registering…')
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SecurityFloodlightsPlatform)
}
