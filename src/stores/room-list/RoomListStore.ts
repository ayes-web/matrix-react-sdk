/*
Copyright 2018-2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { MatrixClient } from "matrix-js-sdk/src/client";
import { Room } from "matrix-js-sdk/src/models/room";
import { isNullOrUndefined } from "matrix-js-sdk/src/utils";
import { logger } from "matrix-js-sdk/src/logger";
import { EventType } from "matrix-js-sdk/src/@types/event";

import SettingsStore from "../../settings/SettingsStore";
import { DefaultTagID, isCustomTag, OrderedDefaultTagIDs, RoomUpdateCause, TagID } from "./models";
import { IListOrderingMap, ITagMap, ITagSortingMap, ListAlgorithm, SortAlgorithm } from "./algorithms/models";
import { ActionPayload } from "../../dispatcher/payloads";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { readReceiptChangeIsFor } from "../../utils/read-receipts";
import { FILTER_CHANGED, FilterKind, IFilterCondition } from "./filters/IFilterCondition";
import { TagWatcher } from "./TagWatcher";
import RoomViewStore from "../RoomViewStore";
import { Algorithm, LIST_UPDATED_EVENT } from "./algorithms/Algorithm";
import { EffectiveMembership, getEffectiveMembership } from "../../utils/membership";
import RoomListLayoutStore from "./RoomListLayoutStore";
import { MarkedExecution } from "../../utils/MarkedExecution";
import { AsyncStoreWithClient } from "../AsyncStoreWithClient";
import { NameFilterCondition } from "./filters/NameFilterCondition";
import { RoomNotificationStateStore } from "../notifications/RoomNotificationStateStore";
import { VisibilityProvider } from "./filters/VisibilityProvider";
import { SpaceWatcher } from "./SpaceWatcher";
import SpaceStore from "../spaces/SpaceStore";
import { Action } from "../../dispatcher/actions";
import { SettingUpdatedPayload } from "../../dispatcher/payloads/SettingUpdatedPayload";
import { IRoomTimelineActionPayload } from "../../actions/MatrixActionCreators";

interface IState {
    tagsEnabled?: boolean;
    unifiedRoomList?: boolean;
}

/**
 * The event/channel which is called when the room lists have been changed. Raised
 * with one argument: the instance of the store.
 */
export const LISTS_UPDATE_EVENT = "lists_update";

export class RoomListStoreClass extends AsyncStoreWithClient<IState> {
    /**
     * Set to true if you're running tests on the store. Should not be touched in
     * any other environment.
     */
    public static TEST_MODE = false;

    private initialListsGenerated = false;
    private algorithm = new Algorithm();
    private filterConditions: IFilterCondition[] = [];
    private prefilterConditions: IFilterCondition[] = [];
    private tagWatcher: TagWatcher;
    private spaceWatcher: SpaceWatcher;
    private updateFn = new MarkedExecution(() => {
        for (const tagId of Object.keys(this.orderedLists)) {
            RoomNotificationStateStore.instance.getListState(tagId).setRooms(this.orderedLists[tagId]);
        }
        this.emit(LISTS_UPDATE_EVENT);
    });

    private readonly watchedSettings = [
        'feature_custom_tags',
        'unifiedRoomList',
    ];

    constructor() {
        super(defaultDispatcher);
        this.setMaxListeners(20); // CustomRoomTagStore + RoomList + LeftPanel + 8xRoomSubList + spares
    }

    private setupWatchers() {
        if (SpaceStore.spacesEnabled) {
            this.spaceWatcher = new SpaceWatcher(this);
        } else {
            this.tagWatcher = new TagWatcher(this);
        }
    }

    public get unfilteredLists(): ITagMap {
        if (!this.algorithm) return {}; // No tags yet.
        return this.algorithm.getUnfilteredRooms();
    }

    public get orderedLists(): ITagMap {
        if (!this.algorithm) return {}; // No tags yet.
        return this.algorithm.getOrderedRooms();
    }

    // Intended for test usage
    public async resetStore() {
        await this.reset();
        this.filterConditions = [];
        this.prefilterConditions = [];
        this.initialListsGenerated = false;
        this.setupWatchers();

        this.algorithm.off(LIST_UPDATED_EVENT, this.onAlgorithmListUpdated);
        this.algorithm.off(FILTER_CHANGED, this.onAlgorithmListUpdated);
        this.algorithm = new Algorithm();
        this.algorithm.on(LIST_UPDATED_EVENT, this.onAlgorithmListUpdated);
        this.algorithm.on(FILTER_CHANGED, this.onAlgorithmListUpdated);

        // Reset state without causing updates as the client will have been destroyed
        // and downstream code will throw NPE errors.
        await this.reset(null, true);
    }

    // Public for test usage. Do not call this.
    public async makeReady(forcedClient?: MatrixClient) {
        if (forcedClient) {
            this.readyStore.useUnitTestClient(forcedClient);
        }

        for (const settingName of this.watchedSettings) SettingsStore.monitorSetting(settingName, null);
        RoomViewStore.addListener(() => this.handleRVSUpdate({}));
        this.algorithm.on(LIST_UPDATED_EVENT, this.onAlgorithmListUpdated);
        this.algorithm.on(FILTER_CHANGED, this.onAlgorithmFilterUpdated);
        this.setupWatchers();

        // Update any settings here, as some may have happened before we were logically ready.
        // Update any settings here, as some may have happened before we were logically ready.
        logger.log("Regenerating room lists: Startup");
        await this.readAndCacheSettingsFromStore();
        this.regenerateAllLists({ trigger: false });
        this.handleRVSUpdate({ trigger: false }); // fake an RVS update to adjust sticky room, if needed

        this.updateFn.mark(); // we almost certainly want to trigger an update.
        this.updateFn.trigger();
    }

    private async readAndCacheSettingsFromStore() {
        const tagsEnabled = SettingsStore.getValue("feature_custom_tags");
        const unifiedRoomList = SettingsStore.getValue("unifiedRoomList");
        await this.updateState({
            tagsEnabled,
            unifiedRoomList,
        });
        this.updateAlgorithmInstances();
    }

    /**
     * Handles suspected RoomViewStore changes.
     * @param trigger Set to false to prevent a list update from being sent. Should only
     * be used if the calling code will manually trigger the update.
     */
    private handleRVSUpdate({ trigger = true }) {
        if (!this.matrixClient) return; // We assume there won't be RVS updates without a client

        const activeRoomId = RoomViewStore.getRoomId();
        if (!activeRoomId && this.algorithm.stickyRoom) {
            this.algorithm.setStickyRoom(null);
        } else if (activeRoomId) {
            const activeRoom = this.matrixClient.getRoom(activeRoomId);
            if (!activeRoom) {
                logger.warn(`${activeRoomId} is current in RVS but missing from client - clearing sticky room`);
                this.algorithm.setStickyRoom(null);
            } else if (activeRoom !== this.algorithm.stickyRoom) {
                this.algorithm.setStickyRoom(activeRoom);
            }
        }

        if (trigger) this.updateFn.trigger();
    }

    protected async onReady(): Promise<any> {
        await this.makeReady();
    }

    protected async onNotReady(): Promise<any> {
        await this.resetStore();
    }

    protected async onAction(payload: ActionPayload) {
        // If we're not remotely ready, don't even bother scheduling the dispatch handling.
        // This is repeated in the handler just in case things change between a decision here and
        // when the timer fires.
        const logicallyReady = this.matrixClient && this.initialListsGenerated;
        if (!logicallyReady) return;

        // When we're running tests we can't reliably use setImmediate out of timing concerns.
        // As such, we use a more synchronous model.
        if (RoomListStoreClass.TEST_MODE) {
            await this.onDispatchAsync(payload);
            return;
        }

        // We do this to intentionally break out of the current event loop task, allowing
        // us to instead wait for a more convenient time to run our updates.
        setImmediate(() => this.onDispatchAsync(payload));
    }

    protected async onDispatchAsync(payload: ActionPayload) {
        // Everything here requires a MatrixClient or some sort of logical readiness.
        const logicallyReady = this.matrixClient && this.initialListsGenerated;
        if (!logicallyReady) return;

        if (payload.action === Action.SettingUpdated) {
            const settingUpdatedPayload = payload as SettingUpdatedPayload;
            if (this.watchedSettings.includes(settingUpdatedPayload.settingName)) {
                logger.log("Regenerating room lists: Settings changed");
                await this.readAndCacheSettingsFromStore();

                this.regenerateAllLists({ trigger: false }); // regenerate the lists now
                this.updateFn.trigger();
            }
        }

        if (!this.algorithm) {
            // This shouldn't happen because `initialListsGenerated` implies we have an algorithm.
            throw new Error("Room list store has no algorithm to process dispatcher update with");
        }

        if (payload.action === 'MatrixActions.Room.receipt') {
            // First see if the receipt event is for our own user. If it was, trigger
            // a room update (we probably read the room on a different device).
            if (readReceiptChangeIsFor(payload.event, this.matrixClient)) {
                const room = payload.room;
                if (!room) {
                    logger.warn(`Own read receipt was in unknown room ${room.roomId}`);
                    return;
                }
                await this.handleRoomUpdate(room, RoomUpdateCause.ReadReceipt);
                this.updateFn.trigger();
                return;
            }
        } else if (payload.action === 'MatrixActions.Room.tags') {
            const roomPayload = (<any>payload); // TODO: Type out the dispatcher types
            await this.handleRoomUpdate(roomPayload.room, RoomUpdateCause.PossibleTagChange);
            this.updateFn.trigger();
        } else if (payload.action === 'MatrixActions.Room.timeline') {
            const eventPayload = <IRoomTimelineActionPayload>payload;

            // Ignore non-live events (backfill) and notification timeline set events (without a room)
            if (!eventPayload.isLiveEvent ||
                !eventPayload.isLiveUnfilteredRoomTimelineEvent ||
                !eventPayload.room
            ) {
                return;
            }

            const roomId = eventPayload.event.getRoomId();
            const room = this.matrixClient.getRoom(roomId);
            const tryUpdate = async (updatedRoom: Room) => {
                if (eventPayload.event.getType() === EventType.RoomTombstone &&
                    eventPayload.event.getStateKey() === ''
                ) {
                    const newRoom = this.matrixClient.getRoom(eventPayload.event.getContent()['replacement_room']);
                    if (newRoom) {
                        // If we have the new room, then the new room check will have seen the predecessor
                        // and did the required updates, so do nothing here.
                        return;
                    }
                }
                await this.handleRoomUpdate(updatedRoom, RoomUpdateCause.Timeline);
                this.updateFn.trigger();
            };
            if (!room) {
                logger.warn(`Live timeline event ${eventPayload.event.getId()} received without associated room`);
                logger.warn(`Queuing failed room update for retry as a result.`);
                setTimeout(async () => {
                    const updatedRoom = this.matrixClient.getRoom(roomId);
                    await tryUpdate(updatedRoom);
                }, 100); // 100ms should be enough for the room to show up
                return;
            } else {
                await tryUpdate(room);
            }
        } else if (payload.action === 'MatrixActions.Event.decrypted') {
            const eventPayload = (<any>payload); // TODO: Type out the dispatcher types
            const roomId = eventPayload.event.getRoomId();
            if (!roomId) {
                return;
            }
            const room = this.matrixClient.getRoom(roomId);
            if (!room) {
                logger.warn(`Event ${eventPayload.event.getId()} was decrypted in an unknown room ${roomId}`);
                return;
            }
            await this.handleRoomUpdate(room, RoomUpdateCause.Timeline);
            this.updateFn.trigger();
        } else if (payload.action === 'MatrixActions.accountData' && payload.event_type === EventType.Direct) {
            const eventPayload = (<any>payload); // TODO: Type out the dispatcher types
            const dmMap = eventPayload.event.getContent();
            for (const userId of Object.keys(dmMap)) {
                const roomIds = dmMap[userId];
                for (const roomId of roomIds) {
                    const room = this.matrixClient.getRoom(roomId);
                    if (!room) {
                        logger.warn(`${roomId} was found in DMs but the room is not in the store`);
                        continue;
                    }

                    // We expect this RoomUpdateCause to no-op if there's no change, and we don't expect
                    // the user to have hundreds of rooms to update in one event. As such, we just hammer
                    // away at updates until the problem is solved. If we were expecting more than a couple
                    // of rooms to be updated at once, we would consider batching the rooms up.
                    await this.handleRoomUpdate(room, RoomUpdateCause.PossibleTagChange);
                }
            }
            this.updateFn.trigger();
        } else if (payload.action === 'MatrixActions.Room.myMembership') {
            const membershipPayload = (<any>payload); // TODO: Type out the dispatcher types
            const oldMembership = getEffectiveMembership(membershipPayload.oldMembership);
            const newMembership = getEffectiveMembership(membershipPayload.membership);
            if (oldMembership !== EffectiveMembership.Join && newMembership === EffectiveMembership.Join) {
                // If we're joining an upgraded room, we'll want to make sure we don't proliferate
                // the dead room in the list.
                const createEvent = membershipPayload.room.currentState.getStateEvents("m.room.create", "");
                if (createEvent && createEvent.getContent()['predecessor']) {
                    const prevRoom = this.matrixClient.getRoom(createEvent.getContent()['predecessor']['room_id']);
                    if (prevRoom) {
                        const isSticky = this.algorithm.stickyRoom === prevRoom;
                        if (isSticky) {
                            this.algorithm.setStickyRoom(null);
                        }

                        // Note: we hit the algorithm instead of our handleRoomUpdate() function to
                        // avoid redundant updates.
                        this.algorithm.handleRoomUpdate(prevRoom, RoomUpdateCause.RoomRemoved);
                    }
                }

                await this.handleRoomUpdate(membershipPayload.room, RoomUpdateCause.NewRoom);
                this.updateFn.trigger();
                return;
            }

            if (oldMembership !== EffectiveMembership.Invite && newMembership === EffectiveMembership.Invite) {
                await this.handleRoomUpdate(membershipPayload.room, RoomUpdateCause.NewRoom);
                this.updateFn.trigger();
                return;
            }

            // If it's not a join, it's transitioning into a different list (possibly historical)
            if (oldMembership !== newMembership) {
                await this.handleRoomUpdate(membershipPayload.room, RoomUpdateCause.PossibleTagChange);
                this.updateFn.trigger();
                return;
            }
        }
    }

    private async handleRoomUpdate(room: Room, cause: RoomUpdateCause): Promise<any> {
        if (cause === RoomUpdateCause.NewRoom && room.getMyMembership() === "invite") {
            // Let the visibility provider know that there is a new invited room. It would be nice
            // if this could just be an event that things listen for but the point of this is that
            // we delay doing anything about this room until the VoipUserMapper had had a chance
            // to do the things it needs to do to decide if we should show this room or not, so
            // an even wouldn't et us do that.
            await VisibilityProvider.instance.onNewInvitedRoom(room);
        }

        if (!VisibilityProvider.instance.isRoomVisible(room)) {
            return; // don't do anything on rooms that aren't visible
        }

        if ((cause === RoomUpdateCause.NewRoom || cause === RoomUpdateCause.PossibleTagChange) &&
            !this.prefilterConditions.every(c => c.isVisible(room))
        ) {
            return; // don't do anything on new/moved rooms which ought not to be shown
        }

        const shouldUpdate = this.algorithm.handleRoomUpdate(room, cause);
        if (shouldUpdate) {
            this.updateFn.mark();
        }
    }

    private async recalculatePrefiltering() {
        if (!this.algorithm) return;
        if (!this.algorithm.hasTagSortingMap) return; // we're still loading

        // Inhibit updates because we're about to lie heavily to the algorithm
        this.algorithm.updatesInhibited = true;

        // Figure out which rooms are about to be valid, and the state of affairs
        const rooms = this.getPlausibleRooms();
        const currentSticky = this.algorithm.stickyRoom;
        const stickyIsStillPresent = currentSticky && rooms.includes(currentSticky);

        // Reset the sticky room before resetting the known rooms so the algorithm
        // doesn't freak out.
        this.algorithm.setStickyRoom(null);
        this.algorithm.setKnownRooms(rooms);

        // Set the sticky room back, if needed, now that we have updated the store.
        // This will use relative stickyness to the new room set.
        if (stickyIsStillPresent) {
            this.algorithm.setStickyRoom(currentSticky);
        }

        // Finally, mark an update and resume updates from the algorithm
        this.updateFn.mark();
        this.algorithm.updatesInhibited = false;
    }

    public async setTagSorting(tagId: TagID, sort: SortAlgorithm) {
        this.setAndPersistTagSorting(tagId, sort);
        this.updateFn.trigger();
    }

    private setAndPersistTagSorting(tagId: TagID, sort: SortAlgorithm) {
        this.algorithm.setTagSorting(tagId, sort);
        // TODO: Per-account? https://github.com/vector-im/element-web/issues/14114
        localStorage.setItem(`mx_tagSort_${tagId}`, sort);
    }

    public getTagSorting(tagId: TagID): SortAlgorithm {
        return this.algorithm.getTagSorting(tagId);
    }

    // noinspection JSMethodCanBeStatic
    private getStoredTagSorting(tagId: TagID): SortAlgorithm {
        // TODO: Per-account? https://github.com/vector-im/element-web/issues/14114
        return <SortAlgorithm>localStorage.getItem(`mx_tagSort_${tagId}`);
    }

    // logic must match calculateListOrder
    private calculateTagSorting(tagId: TagID): SortAlgorithm {
        // TODO SC here
        //const isDefaultRecent = tagId === DefaultTagID.Invite || tagId === DefaultTagID.DM;
        const defaultSort = SortAlgorithm.Recent;//isDefaultRecent ? SortAlgorithm.Recent : SortAlgorithm.Alphabetic;
        const settingAlphabetical = SettingsStore.getValue("RoomList.orderAlphabetically", null, false);
        const definedSort = this.getTagSorting(tagId);
        const storedSort = this.getStoredTagSorting(tagId);

        // We use the following order to determine which of the 4 flags to use:
        // Stored > Settings > Defined > Default

        let tagSort = defaultSort;
        if (storedSort) {
            tagSort = storedSort;
        } else if (!isNullOrUndefined(settingAlphabetical)) {
            tagSort = settingAlphabetical ? SortAlgorithm.Alphabetic : SortAlgorithm.Recent;
        } else if (definedSort) {
            tagSort = definedSort;
        } // else default (already set)

        return tagSort;
    }

    public setListOrder(tagId: TagID, order: ListAlgorithm) {
        this.setAndPersistListOrder(tagId, order);
        this.updateFn.trigger();
    }

    private setAndPersistListOrder(tagId: TagID, order: ListAlgorithm) {
        this.algorithm.setListOrdering(tagId, order);
        // TODO: Per-account? https://github.com/vector-im/element-web/issues/14114
        localStorage.setItem(`mx_listOrder_${tagId}`, order);
    }

    public getListOrder(tagId: TagID): ListAlgorithm {
        return this.algorithm.getListOrdering(tagId);
    }

    // noinspection JSMethodCanBeStatic
    private getStoredListOrder(tagId: TagID): ListAlgorithm {
        // TODO: Per-account? https://github.com/vector-im/element-web/issues/14114
        return <ListAlgorithm>localStorage.getItem(`mx_listOrder_${tagId}`);
    }

    // logic must match calculateTagSorting
    private calculateListOrder(tagId: TagID): ListAlgorithm {
        const defaultOrder = ListAlgorithm.Natural;
        const settingImportance = SettingsStore.getValue("RoomList.orderByImportance", null, true);
        const definedOrder = this.getListOrder(tagId);
        const storedOrder = this.getStoredListOrder(tagId);

        // We use the following order to determine which of the 4 flags to use:
        // Stored > Settings > Defined > Default

        let listOrder = defaultOrder;
        if (storedOrder) {
            listOrder = storedOrder;
        } else if (!isNullOrUndefined(settingImportance)) {
            listOrder = settingImportance ? ListAlgorithm.Importance : ListAlgorithm.Natural;
        } else if (definedOrder) {
            listOrder = definedOrder;
        } // else default (already set)

        return listOrder;
    }

    private updateAlgorithmInstances() {
        // We'll require an update, so mark for one. Marking now also prevents the calls
        // to setTagSorting and setListOrder from causing triggers.
        this.updateFn.mark();

        for (const tag of Object.keys(this.orderedLists)) {
            const definedSort = this.getTagSorting(tag);
            const definedOrder = this.getListOrder(tag);

            const tagSort = this.calculateTagSorting(tag);
            const listOrder = this.calculateListOrder(tag);

            if (tagSort !== definedSort) {
                this.setAndPersistTagSorting(tag, tagSort);
            }
            if (listOrder !== definedOrder) {
                this.setAndPersistListOrder(tag, listOrder);
            }
        }

        // SC: Unified list for DMs and groups
        this.algorithm.setUnifiedRoomList(this.state.unifiedRoomList);
    }

    private onAlgorithmListUpdated = () => {
        this.updateFn.mark();
    };

    private onAlgorithmFilterUpdated = () => {
        // The filter can happen off-cycle, so trigger an update. The filter will have
        // already caused a mark.
        this.updateFn.trigger();
    };

    private onPrefilterUpdated = async () => {
        await this.recalculatePrefiltering();
        this.updateFn.trigger();
    };

    private getPlausibleRooms(): Room[] {
        if (!this.matrixClient) return [];

        let rooms = this.matrixClient.getVisibleRooms().filter(r => VisibilityProvider.instance.isRoomVisible(r));

        // if spaces are enabled only consider the prefilter conditions when there are no runtime conditions
        // for the search all spaces feature
        if (this.prefilterConditions.length > 0 && (!SpaceStore.spacesEnabled || !this.filterConditions.length)) {
            rooms = rooms.filter(r => {
                for (const filter of this.prefilterConditions) {
                    if (!filter.isVisible(r)) {
                        return false;
                    }
                }
                return true;
            });
        }

        return rooms;
    }

    /**
     * Regenerates the room whole room list, discarding any previous results.
     *
     * Note: This is only exposed externally for the tests. Do not call this from within
     * the app.
     * @param trigger Set to false to prevent a list update from being sent. Should only
     * be used if the calling code will manually trigger the update.
     */
    public regenerateAllLists({ trigger = true }) {
        logger.warn("Regenerating all room lists");

        const rooms = this.getPlausibleRooms();

        const customTags = new Set<TagID>();
        if (this.state.tagsEnabled) {
            for (const room of rooms) {
                if (!room.tags) continue;
                const tags = Object.keys(room.tags).filter(t => isCustomTag(t));
                tags.forEach(t => customTags.add(t));
            }
        }

        const sorts: ITagSortingMap = {};
        const orders: IListOrderingMap = {};
        const allTags = [...OrderedDefaultTagIDs, ...Array.from(customTags)];
        for (const tagId of allTags) {
            sorts[tagId] = this.calculateTagSorting(tagId);
            orders[tagId] = this.calculateListOrder(tagId);

            RoomListLayoutStore.instance.ensureLayoutExists(tagId);
        }

        this.algorithm.populateTags(sorts, orders);
        this.algorithm.setKnownRooms(rooms);

        this.initialListsGenerated = true;

        if (trigger) this.updateFn.trigger();
    }

    /**
     * Adds a filter condition to the room list store. Filters may be applied async,
     * and thus might not cause an update to the store immediately.
     * @param {IFilterCondition} filter The filter condition to add.
     */
    public async addFilter(filter: IFilterCondition): Promise<void> {
        let promise = Promise.resolve();
        if (filter.kind === FilterKind.Prefilter) {
            filter.on(FILTER_CHANGED, this.onPrefilterUpdated);
            this.prefilterConditions.push(filter);
            promise = this.recalculatePrefiltering();
        } else {
            this.filterConditions.push(filter);
            // Runtime filters with spaces disable prefiltering for the search all spaces feature
            if (SpaceStore.spacesEnabled) {
                // this has to be awaited so that `setKnownRooms` is called in time for the `addFilterCondition` below
                // this way the runtime filters are only evaluated on one dataset and not both.
                await this.recalculatePrefiltering();
            }
            if (this.algorithm) {
                this.algorithm.addFilterCondition(filter);
            }
        }
        promise.then(() => this.updateFn.trigger());
    }

    /**
     * Removes a filter condition from the room list store. If the filter was
     * not previously added to the room list store, this will no-op. The effects
     * of removing a filter may be applied async and therefore might not cause
     * an update right away.
     * @param {IFilterCondition} filter The filter condition to remove.
     */
    public removeFilter(filter: IFilterCondition): void {
        let promise = Promise.resolve();
        let idx = this.filterConditions.indexOf(filter);
        let removed = false;
        if (idx >= 0) {
            this.filterConditions.splice(idx, 1);

            if (this.algorithm) {
                this.algorithm.removeFilterCondition(filter);
            }
            // Runtime filters with spaces disable prefiltering for the search all spaces feature
            if (SpaceStore.spacesEnabled) {
                promise = this.recalculatePrefiltering();
            }
            removed = true;
        }

        idx = this.prefilterConditions.indexOf(filter);
        if (idx >= 0) {
            filter.off(FILTER_CHANGED, this.onPrefilterUpdated);
            this.prefilterConditions.splice(idx, 1);
            promise = this.recalculatePrefiltering();
            removed = true;
        }

        if (removed) {
            promise.then(() => this.updateFn.trigger());
        }
    }

    /**
     * Gets the first (and ideally only) name filter condition. If one isn't present,
     * this returns null.
     * @returns The first name filter condition, or null if none.
     */
    public getFirstNameFilterCondition(): NameFilterCondition | null {
        for (const filter of this.filterConditions) {
            if (filter instanceof NameFilterCondition) {
                return filter;
            }
        }
        return null;
    }

    /**
     * Gets the tags for a room identified by the store. The returned set
     * should never be empty, and will contain DefaultTagID.Untagged if
     * the store is not aware of any tags.
     * @param room The room to get the tags for.
     * @returns The tags for the room.
     */
    public getTagsForRoom(room: Room): TagID[] {
        const algorithmTags = this.algorithm.getTagsForRoom(room);

        if (!algorithmTags) {
            if (this.state.unifiedRoomList) {
                return [DefaultTagID.Unified];
            } else {
                return [DefaultTagID.Untagged];
            }
        }

        const dmTagIndex = algorithmTags.indexOf(DefaultTagID.DM);
        if (dmTagIndex !== -1) {
            algorithmTags[dmTagIndex] = DefaultTagID.Unified;
        }
        const untaggedTagIndex = algorithmTags.indexOf(DefaultTagID.Untagged);
        if (untaggedTagIndex !== -1) {
            algorithmTags[untaggedTagIndex] = DefaultTagID.Unified;
        }
        return algorithmTags;
    }

    /**
     * Manually update a room with a given cause. This should only be used if the
     * room list store would otherwise be incapable of doing the update itself. Note
     * that this may race with the room list's regular operation.
     * @param {Room} room The room to update.
     * @param {RoomUpdateCause} cause The cause to update for.
     */
    public async manualRoomUpdate(room: Room, cause: RoomUpdateCause) {
        await this.handleRoomUpdate(room, cause);
        this.updateFn.trigger();
    }
}

export default class RoomListStore {
    private static internalInstance: RoomListStoreClass;

    public static get instance(): RoomListStoreClass {
        if (!RoomListStore.internalInstance) {
            RoomListStore.internalInstance = new RoomListStoreClass();
        }

        return RoomListStore.internalInstance;
    }
}

window.mxRoomListStore = RoomListStore.instance;
