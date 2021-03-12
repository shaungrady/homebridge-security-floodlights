import { CharacteristicValue, PlatformAccessory } from 'homebridge'
import { BehaviorSubject, ConnectableObservable, of } from 'rxjs'
import {
	delay,
	distinctUntilChanged,
	map,
	publishReplay,
	startWith,
	switchMap,
	tap,
} from 'rxjs/operators'

import { SecurityFloodlightsPlatform } from '../platform'

type OccupancyDetectedState = CharacteristicValue | number
type StatusTamperedState = CharacteristicValue | number
type StatusActiveState = CharacteristicValue | boolean

export class OccupancySensorAccessory {
	readonly device = this.accessory.context.device

	private readonly service =
		this.accessory.getService(this.platform.Service.OccupancySensor) ||
		this.accessory.addService(this.platform.Service.OccupancySensor)

	readonly OccupancyDetected = this.platform.Characteristic.OccupancyDetected
	readonly OCCUPANCY_DETECTED = this.OccupancyDetected.OCCUPANCY_DETECTED
	readonly OCCUPANCY_NOT_DETECTED = this.OccupancyDetected
		.OCCUPANCY_NOT_DETECTED

	readonly StatusTampered = this.platform.Characteristic.StatusTampered
	readonly TAMPERED = this.StatusTampered.TAMPERED
	readonly NOT_TAMPERED = this.StatusTampered.NOT_TAMPERED

	readonly StatusActive = this.platform.Characteristic.StatusActive
	readonly On = this.platform.Characteristic.On

	//////////////////////////////////////////////////////////////////////////////
	// Private State Members /////////////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////

	/** This drives the OccupancyDetected state. */
	#activeMotionSwitchCount = new BehaviorSubject<number>(0)

	#occupancyDetected$ = new BehaviorSubject<OccupancyDetectedState>(
		this.OCCUPANCY_NOT_DETECTED
	)

	private get occupancyDetected(): OccupancyDetectedState {
		return this.#occupancyDetected$.getValue()
	}

	private set occupancyDetected(state: OccupancyDetectedState) {
		this.#occupancyDetected$.next(state)
	}

	// This state is on when the light group override switch is on.
	#statusTampered$ = new BehaviorSubject<StatusTamperedState>(this.NOT_TAMPERED)

	private get statusTampered(): StatusTamperedState {
		return this.#statusTampered$.getValue()
	}

	private set statusTampered(state: StatusTamperedState) {
		this.#statusTampered$.next(state)
	}

	// This state is on when the system is armed, and off when the system is disarmed
	// of when then Wind Override switch is on.
	#statusActive$ = new BehaviorSubject<StatusActiveState>(false)

	private get statusActive(): StatusActiveState {
		return this.#statusActive$.getValue()
	}

	private set statusActive(state: StatusActiveState) {
		this.#statusActive$.next(state)
	}

	//////////////////////////////////////////////////////////////////////////////
	// OccupancyDetected Public Members //////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////

	readonly isOccupied$: ConnectableObservable<boolean> = this.#occupancyDetected$.pipe(
		distinctUntilChanged(),
		tap((state) => {
			this.service.updateCharacteristic(this.OccupancyDetected, state)
			this.platform.log.info(
				`${this.device.displayName} occupancy: ${state ? 'yes' : 'no'}`
			)
		}),
		map((state) => state === this.OCCUPANCY_DETECTED),
		publishReplay(1)
	) as ConnectableObservable<boolean>

	get isOccupied(): boolean {
		return this.#occupancyDetected$.getValue() === this.OCCUPANCY_DETECTED
	}

	set isOccupied(bool: boolean) {
		const { OCCUPANCY_DETECTED, OCCUPANCY_NOT_DETECTED } = this
		const state = bool ? OCCUPANCY_DETECTED : OCCUPANCY_NOT_DETECTED
		this.#occupancyDetected$.next(state)
	}

	//////////////////////////////////////////////////////////////////////////////
	// StatusTampered Public Members /////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////

	readonly isTampered$: ConnectableObservable<boolean> = this.#statusTampered$.pipe(
		distinctUntilChanged(),
		tap((state) => {
			this.service.updateCharacteristic(this.StatusTampered, state)
			this.platform.log.info(
				`${this.device.displayName} tampered: ${state ? 'yes' : 'no'}`
			)
		}),
		map((state) => state === this.TAMPERED),
		publishReplay(1)
	) as ConnectableObservable<boolean>

	get isTampered(): boolean {
		return this.#statusTampered$.getValue() === this.TAMPERED
	}

	set isTampered(bool: boolean) {
		const { TAMPERED, NOT_TAMPERED } = this
		const state = bool ? TAMPERED : NOT_TAMPERED
		this.#statusTampered$.next(state)
	}

	//////////////////////////////////////////////////////////////////////////////
	// StatusActive Public Members ///////////////////////////////////////////////
	//////////////////////////////////////////////////////////////////////////////

	readonly isActive$: ConnectableObservable<boolean> = this.#statusActive$.pipe(
		distinctUntilChanged(),
		tap((state) => {
			this.service.updateCharacteristic(this.StatusActive, state)
			this.platform.log.info(
				`${this.device.displayName} active: ${state ? 'yes' : 'no'}`
			)
		}),
		map(Boolean),
		publishReplay(1)
	) as ConnectableObservable<boolean>

	get isActive(): boolean {
		return this.#statusActive$.getValue() === true
	}

	set isActive(bool: boolean) {
		this.#statusActive$.next(bool)
	}

	constructor(
		private readonly platform: SecurityFloodlightsPlatform,
		private readonly accessory: PlatformAccessory
	) {
		const { device, service } = this

		service.setCharacteristic(
			this.platform.Characteristic.Name,
			`${device.displayName} Occupancy`
		)

		this.bindStateHandlers()
		this.bindMotionSwitchesToOccupancy()
		this.addMotionSensorSwitches()

		this.isOccupied$.connect()
		this.isTampered$.connect()
		this.isActive$.connect()
	}

	private bindStateHandlers(): void {
		const { OccupancyDetected, StatusTampered, StatusActive } = this

		this.service
			.getCharacteristic(OccupancyDetected)
			.onGet(() => this.occupancyDetected)
			.onSet((state) => {
				this.occupancyDetected = state
			})

		this.service
			.getCharacteristic(StatusTampered)
			.onGet(() => this.statusTampered)
			.onSet((state) => {
				this.statusTampered = state
			})

		this.service
			.getCharacteristic(StatusActive)
			.onGet(() => this.statusActive)
			.onSet((state) => {
				this.statusActive = state
			})
	}

	private bindMotionSwitchesToOccupancy(): void {
		const {
			device: { displayName, occupancyTimeoutSeconds },
			platform: { log },
		} = this
		const msDelay = occupancyTimeoutSeconds * 1_000

		this.#activeMotionSwitchCount
			.pipe(
				tap((count) =>
					log.debug(`${displayName} active motion switches: ${count}`)
				),
				map((count) => count > 0),
				switchMap((isActive) =>
					isActive ? of(isActive) : of(isActive).pipe(delay(msDelay))
				),
				startWith(false),
				distinctUntilChanged(),
				tap((isActive) => {
					if (isActive) {
						log.debug(`${displayName} motion switches active`)
					} else {
						log.debug(`${displayName} motion switch inactivity timeout reached`)
					}
				})
			)
			.subscribe((isActive) => (this.isOccupied = isActive))
	}

	private addMotionSensorSwitches(): void {
		const { id, displayName, motionSensorCount } = this.device
		const baseName = `${displayName} Floodlight Motion`
		const statesBySwitch = new Map<unknown, CharacteristicValue>()

		for (let i = 0; i < motionSensorCount; i++) {
			const switchName = `${baseName} ${i + 1}`
			const switchId = `${id}-motion-${i}`

			const motionSwitch =
				this.accessory.getService(switchName) ||
				this.accessory.addService(
					this.platform.Service.Switch,
					switchName,
					switchId
				)

			motionSwitch
				.getCharacteristic(this.On)
				.onGet(() => statesBySwitch.get(motionSwitch) || false)
				.onSet((state) => {
					statesBySwitch.set(motionSwitch, state)
					this.updateActiveSwitchCount(statesBySwitch)
				})
		}
	}

	private updateActiveSwitchCount(
		stateMap: Map<unknown, CharacteristicValue>
	): void {
		const activeCount = [...stateMap.values()]
			.map(Number)
			.reduce((a, b) => a + b, 0)

		this.#activeMotionSwitchCount.next(activeCount)
	}
}
