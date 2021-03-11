import { CharacteristicValue, PlatformAccessory } from 'homebridge'
import { BehaviorSubject, ConnectableObservable, noop } from 'rxjs'
import {
	distinctUntilChanged,
	filter,
	map,
	publishReplay,
	tap,
} from 'rxjs/operators'

import { SecurityFloodlightsPlatform } from '../platform'

type State = CharacteristicValue | number

export class SecuritySystemAccessory {
	private readonly service =
		this.accessory.getService(this.platform.Service.SecuritySystem) ||
		this.accessory.addService(this.platform.Service.SecuritySystem)

	readonly device = this.accessory.context.device

	private readonly TargetState = this.platform.Characteristic
		.SecuritySystemTargetState

	private readonly CurrentState = this.platform.Characteristic
		.SecuritySystemCurrentState

	private readonly DISARMED = this.CurrentState.DISARMED
	private readonly STAY_ARM = this.CurrentState.STAY_ARM
	private readonly NIGHT_ARM = this.CurrentState.NIGHT_ARM

	/** Drives state updates and sharing with the platform. */
	#currentState$ = new BehaviorSubject<State>(this.DISARMED)

	private get currentState(): State {
		return this.#currentState$.getValue()
	}

	private set currentState(state: State) {
		this.#currentState$.next(state)
	}

	readonly currentState$: ConnectableObservable<State> = this.#currentState$.pipe(
		distinctUntilChanged(),
		tap((state) => {
			this.service.updateCharacteristic(this.CurrentState, state)
			const stateName = this.#stateNames.get(state) || state
			this.platform.log.info(
				`${this.device.displayName} state to: ${stateName}`
			)
		}),
		publishReplay(1)
	) as ConnectableObservable<State>

	readonly isArmed$: ConnectableObservable<boolean> = this.#currentState$.pipe(
		map((state) => state !== this.DISARMED),
		distinctUntilChanged(),
		publishReplay(1)
	) as ConnectableObservable<boolean>

	readonly arm$ = this.isArmed$.pipe(
		filter((isArmed) => isArmed),
		map(noop)
	)

	readonly disarm$ = this.isArmed$.pipe(
		filter((isArmed) => !isArmed),
		map(noop)
	)

	get isDisarmed(): boolean {
		return this.currentState === this.DISARMED
	}

	get isArmed(): boolean {
		return !this.isDisarmed
	}

	// For ease of logging
	#stateNames: ReadonlyMap<State, string> = new Map([
		[this.DISARMED, 'disarmed'],
		[this.STAY_ARM, 'stay'],
		[this.NIGHT_ARM, 'night'],
	])

	constructor(
		private readonly platform: SecurityFloodlightsPlatform,
		private readonly accessory: PlatformAccessory
	) {
		const {
			device,
			service,
			TargetState,
			CurrentState,
			STAY_ARM,
			NIGHT_ARM,
			DISARMED,
		} = this

		service.setCharacteristic(
			this.platform.Characteristic.Manufacturer,
			`Shaun Grady (.com)`
		)

		service.setCharacteristic(platform.Characteristic.Name, device.displayName)

		service
			.getCharacteristic(TargetState)
			.setProps({ validValues: [STAY_ARM, NIGHT_ARM, DISARMED] })
			.onGet(() => this.currentState)
			.onSet((state) => {
				this.currentState = state
			})

		service.getCharacteristic(CurrentState).onGet(() => this.currentState)

		this.currentState$.connect()
		this.isArmed$.connect()
	}
}
