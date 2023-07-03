import { CharacteristicValue, PlatformAccessory } from 'homebridge'
import { BehaviorSubject, ConnectableObservable, noop } from 'rxjs'
import {
	distinctUntilChanged,
	filter,
	map,
	publishReplay,
	tap,
} from 'rxjs/operators'

import { MANUFACTURER } from '../constants'
import { SecurityFloodlightsPlatform } from '../platform'

type OnState = CharacteristicValue | boolean

export class SwitchAccessory {
	readonly device = this.accessory.context.device
	readonly informationService = this.accessory.getService(
		this.platform.Service.AccessoryInformation
	)!

	private readonly service =
		this.accessory.getService(this.platform.Service.Switch) ||
		this.accessory.addService(this.platform.Service.Switch)

	private readonly On = this.platform.Characteristic.On

	#on$ = new BehaviorSubject<OnState>(this.accessory.context.state ?? false)

	private get on(): OnState {
		return this.#on$.getValue()
	}

	private set on(bool: OnState) {
		this.#on$.next(bool)
	}

	readonly isOn$: ConnectableObservable<boolean> = this.#on$.pipe(
		distinctUntilChanged(),
		tap((state) => {
			// Save to HomeBridge
			this.accessory.context.state = state
			this.platform.api.updatePlatformAccessories([this.accessory])

			// Publish to HomeKit
			this.service.updateCharacteristic(this.On, state)
			this.platform.log.info(
				`${this.device.displayName}: ${state ? 'on' : 'off'}`
			)
		}),
		map(Boolean),
		publishReplay(1)
	) as ConnectableObservable<boolean>

	readonly on$ = this.isOn$.pipe(
		filter((isOn) => isOn),
		map(noop)
	)

	readonly off$ = this.isOn$.pipe(
		filter((isOn) => !isOn),
		map(noop)
	)

	get isOn(): boolean {
		return !!this.on
	}

	set isOn(bool: boolean) {
		this.on = bool
	}

	get isOff(): boolean {
		return !this.isOn
	}

	constructor(
		private readonly platform: SecurityFloodlightsPlatform,
		private readonly accessory: PlatformAccessory
	) {
		const { device, service, On } = this
		service.setCharacteristic(
			this.platform.Characteristic.Name,
			device.displayName
		)

		this.informationService.setCharacteristic(
			this.platform.Characteristic.Manufacturer,
			MANUFACTURER
		)

		this.informationService.setCharacteristic(
			this.platform.Characteristic.Model,
			'Switch'
		)

		this.informationService.setCharacteristic(
			this.platform.Characteristic.SerialNumber,
			this.accessory.context.serialNumber
		)

		this.service
			.getCharacteristic(On)
			.onGet(() => this.on)
			.onSet((state) => {
				this.on = state
			})

		this.isOn$.connect()
	}
}
