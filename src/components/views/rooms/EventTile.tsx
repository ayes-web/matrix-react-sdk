/*
Copyright 2015-2021 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

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

import React, { createRef } from 'react';
import classNames from "classnames";
import { EventType, MsgType, RelationType } from "matrix-js-sdk/src/@types/event";
import { EventStatus, MatrixEvent } from "matrix-js-sdk/src/models/event";
import { Relations } from "matrix-js-sdk/src/models/relations";
import { RoomMember } from "matrix-js-sdk/src/models/room-member";
import { Thread, ThreadEvent } from 'matrix-js-sdk/src/models/thread';
import { logger } from "matrix-js-sdk/src/logger";
import { NotificationCountType, Room } from 'matrix-js-sdk/src/models/room';
import { CallErrorCode } from "matrix-js-sdk/src/webrtc/call";
import { M_POLL_START } from "matrix-events-sdk";

import ReplyChain from "../elements/ReplyChain";
import { _t } from '../../../languageHandler';
import { hasText } from "../../../TextForEvent";
import * as sdk from "../../../index";
import dis from '../../../dispatcher/dispatcher';
import { Layout } from "../../../settings/enums/Layout";
import { formatTime } from "../../../DateUtils";
import { MatrixClientPeg } from '../../../MatrixClientPeg';
import { ALL_RULE_TYPES } from "../../../mjolnir/BanList";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { E2EState } from "./E2EIcon";
import { toRem } from "../../../utils/units";
import { WidgetType } from "../../../widgets/WidgetType";
import RoomAvatar from "../avatars/RoomAvatar";
import { WIDGET_LAYOUT_EVENT_TYPE } from "../../../stores/widgets/WidgetLayoutStore";
import { objectHasDiff } from "../../../utils/objects";
import { replaceableComponent } from "../../../utils/replaceableComponent";
import Tooltip from "../elements/Tooltip";
import EditorStateTransfer from "../../../utils/EditorStateTransfer";
import { RoomPermalinkCreator } from '../../../utils/permalinks/Permalinks';
import { StaticNotificationState } from "../../../stores/notifications/StaticNotificationState";
import NotificationBadge from "./NotificationBadge";
import CallEventGrouper from "../../structures/CallEventGrouper";
import { ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { Action } from '../../../dispatcher/actions';
import MemberAvatar from '../avatars/MemberAvatar';
import SenderProfile from '../messages/SenderProfile';
import MessageTimestamp from '../messages/MessageTimestamp';
import TooltipButton from '../elements/TooltipButton';
import ReadReceiptMarker, { IReadReceiptInfo } from "./ReadReceiptMarker";
import MessageActionBar from "../messages/MessageActionBar";
import ReactionsRow from '../messages/ReactionsRow';
import { getEventDisplayInfo } from '../../../utils/EventUtils';
import SettingsStore from "../../../settings/SettingsStore";
import { UserNameColorMode } from '../../../settings/enums/UserNameColorMode';
import MKeyVerificationConclusion from "../messages/MKeyVerificationConclusion";
import { showThread } from '../../../dispatcher/dispatch-actions/threads';
import { MessagePreviewStore } from '../../../stores/room-list/MessagePreviewStore';
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import Toolbar from '../../../accessibility/Toolbar';
import { RovingAccessibleTooltipButton } from '../../../accessibility/roving/RovingAccessibleTooltipButton';
import { ThreadNotificationState } from '../../../stores/notifications/ThreadNotificationState';
import { RoomNotificationStateStore } from '../../../stores/notifications/RoomNotificationStateStore';
import { NotificationStateEvents } from '../../../stores/notifications/NotificationState';
import { NotificationColor } from '../../../stores/notifications/NotificationColor';
import AccessibleButton, { ButtonEvent } from '../elements/AccessibleButton';
import { CardContext } from '../right_panel/BaseCard';
import { copyPlaintext } from '../../../utils/strings';
import { DecryptionFailureTracker } from '../../../DecryptionFailureTracker';
import RedactedBody from '../messages/RedactedBody';

const eventTileTypes = {
    [EventType.RoomMessage]: 'messages.MessageEvent',
    [EventType.Sticker]: 'messages.MessageEvent',
    [M_POLL_START.name]: 'messages.MessageEvent',
    [M_POLL_START.altName]: 'messages.MessageEvent',
    [EventType.KeyVerificationCancel]: 'messages.MKeyVerificationConclusion',
    [EventType.KeyVerificationDone]: 'messages.MKeyVerificationConclusion',
    [EventType.CallInvite]: 'messages.CallEvent',
};

const stateEventTileTypes = {
    [EventType.RoomEncryption]: 'messages.EncryptionEvent',
    [EventType.RoomCanonicalAlias]: 'messages.TextualEvent',
    [EventType.RoomCreate]: 'messages.RoomCreate',
    [EventType.RoomMember]: 'messages.TextualEvent',
    [EventType.RoomName]: 'messages.TextualEvent',
    [EventType.RoomAvatar]: 'messages.RoomAvatarEvent',
    [EventType.RoomThirdPartyInvite]: 'messages.TextualEvent',
    [EventType.RoomHistoryVisibility]: 'messages.TextualEvent',
    [EventType.RoomTopic]: 'messages.TextualEvent',
    [EventType.RoomPowerLevels]: 'messages.TextualEvent',
    [EventType.RoomPinnedEvents]: 'messages.TextualEvent',
    [EventType.RoomServerAcl]: 'messages.TextualEvent',
    // TODO: Enable support for m.widget event type (https://github.com/vector-im/element-web/issues/13111)
    'im.vector.modular.widgets': 'messages.TextualEvent',
    [WIDGET_LAYOUT_EVENT_TYPE]: 'messages.TextualEvent',
    [EventType.RoomTombstone]: 'messages.TextualEvent',
    [EventType.RoomJoinRules]: 'messages.TextualEvent',
    [EventType.RoomGuestAccess]: 'messages.TextualEvent',
    'm.room.related_groups': 'messages.TextualEvent', // legacy communities flair
};

const stateEventSingular = new Set([
    EventType.RoomEncryption,
    EventType.RoomCanonicalAlias,
    EventType.RoomCreate,
    EventType.RoomName,
    EventType.RoomAvatar,
    EventType.RoomHistoryVisibility,
    EventType.RoomTopic,
    EventType.RoomPowerLevels,
    EventType.RoomPinnedEvents,
    EventType.RoomServerAcl,
    WIDGET_LAYOUT_EVENT_TYPE,
    EventType.RoomTombstone,
    EventType.RoomJoinRules,
    EventType.RoomGuestAccess,
    'm.room.related_groups',
]);

// Add all the Mjolnir stuff to the renderer
for (const evType of ALL_RULE_TYPES) {
    stateEventTileTypes[evType] = 'messages.TextualEvent';
}

export function getHandlerTile(ev: MatrixEvent): string {
    const type = ev.getType();

    // don't show verification requests we're not involved in,
    // not even when showing hidden events
    if (type === EventType.RoomMessage) {
        const content = ev.getContent();
        if (content && content.msgtype === MsgType.KeyVerificationRequest) {
            const me = MatrixClientPeg.get()?.getUserId();
            if (ev.getSender() !== me && content.to !== me) {
                return undefined;
            } else {
                return "messages.MKeyVerificationRequest";
            }
        }
    }
    // these events are sent by both parties during verification, but we only want to render one
    // tile once the verification concludes, so filter out the one from the other party.
    if (type === EventType.KeyVerificationDone) {
        const me = MatrixClientPeg.get()?.getUserId();
        if (ev.getSender() !== me) {
            return undefined;
        }
    }

    // sometimes MKeyVerificationConclusion declines to render. Jankily decline to render and
    // fall back to showing hidden events, if we're viewing hidden events
    // XXX: This is extremely a hack. Possibly these components should have an interface for
    // declining to render?
    if (type === EventType.KeyVerificationCancel || type === EventType.KeyVerificationDone) {
        if (!MKeyVerificationConclusion.shouldRender(ev, ev.verificationRequest)) {
            return;
        }
    }

    // TODO: Enable support for m.widget event type (https://github.com/vector-im/element-web/issues/13111)
    if (type === "im.vector.modular.widgets") {
        let type = ev.getContent()['type'];
        if (!type) {
            // deleted/invalid widget - try the past widget type
            type = ev.getPrevContent()['type'];
        }

        if (WidgetType.JITSI.matches(type)) {
            return "messages.MJitsiWidgetEvent";
        }
    }

    if (ev.isState()) {
        if (stateEventSingular.has(type) && ev.getStateKey() !== "") return undefined;
        return stateEventTileTypes[type];
    }

    if (ev.isRedacted()) {
        return "messages.MessageEvent";
    }

    return eventTileTypes[type];
}

// Our component structure for EventTiles on the timeline is:
//
// .-EventTile------------------------------------------------.
// | MemberAvatar (SenderProfile)                   TimeStamp |
// |    .-{Message,Textual}Event---------------. Read Avatars |
// |    |   .-MFooBody-------------------.     |              |
// |    |   |  (only if MessageEvent)    |     |              |
// |    |   '----------------------------'     |              |
// |    '--------------------------------------'              |
// '----------------------------------------------------------'

export interface IReadReceiptProps {
    userId: string;
    roomMember: RoomMember;
    ts: number;
}

export enum TileShape {
    Notif = "notif",
    FileGrid = "file_grid",
    Pinned = "pinned",
    Thread = "thread",
    ThreadPanel = "thread_list"
}

interface IProps {
    // the MatrixEvent to show
    mxEvent: MatrixEvent;

    // true if mxEvent is redacted. This is a prop because using mxEvent.isRedacted()
    // might not be enough when deciding shouldComponentUpdate - prevProps.mxEvent
    // references the same this.props.mxEvent.
    isRedacted?: boolean;

    // true if this is a continuation of the previous event (which has the
    // effect of not showing another avatar/displayname
    continuation?: boolean;

    // true if this is the last event in the timeline (which has the effect
    // of always showing the timestamp)
    last?: boolean;

    // true if the event is the last event in a section (adds a css class for
    // targeting)
    lastInSection?: boolean;

    // True if the event is the last successful (sent) event.
    lastSuccessful?: boolean;

    // true if this is search context (which has the effect of greying out
    // the text
    contextual?: boolean;

    // a list of words to highlight, ordered by longest first
    highlights?: string[];

    // link URL for the highlights
    highlightLink?: string;

    // should show URL previews for this event
    showUrlPreview?: boolean;

    // is this the focused event
    isSelectedEvent?: boolean;

    // callback called when dynamic content in events are loaded
    onHeightChanged?: () => void;

    // a list of read-receipts we should show. Each object has a 'roomMember' and 'ts'.
    readReceipts?: IReadReceiptProps[];

    // opaque readreceipt info for each userId; used by ReadReceiptMarker
    // to manage its animations. Should be an empty object when the room
    // first loads
    readReceiptMap?: { [userId: string]: IReadReceiptInfo };

    // A function which is used to check if the parent panel is being
    // unmounted, to avoid unnecessary work. Should return true if we
    // are being unmounted.
    checkUnmounting?: () => boolean;

    // the status of this event - ie, mxEvent.status. Denormalised to here so
    // that we can tell when it changes.
    eventSendStatus?: string;

    // the shape of the tile. by default, the layout is intended for the
    // normal room timeline.  alternative values are: "file_list", "file_grid"
    // and "notif".  This could be done by CSS, but it'd be horribly inefficient.
    // It could also be done by subclassing EventTile, but that'd be quite
    // boiilerplatey.  So just make the necessary render decisions conditional
    // for now.
    tileShape?: TileShape;

    forExport?: boolean;

    // show twelve hour timestamps
    isTwelveHour?: boolean;

    // helper function to access relations for this event
    getRelationsForEvent?: (eventId: string, relationType: string, eventType: string) => Relations;

    // whether to show reactions for this event
    showReactions?: boolean;

    // which layout to use
    layout?: Layout;

    // whether to use single side bubbles
    singleSideBubbles?: boolean;

    // Specifies which userNameColorMode to use.
    userNameColorMode?: UserNameColorMode;

    // Specifies whether youtube embed player is enabled
    youtubeEmbedPlayer?: boolean;

    // whether or not to show flair at all
    enableFlair?: boolean;

    // whether or not to show read receipts
    showReadReceipts?: boolean;

    // Used while editing, to pass the event, and to preserve editor state
    // from one editor instance to another when remounting the editor
    // upon receiving the remote echo for an unsent event.
    editState?: EditorStateTransfer;

    // Event ID of the event replacing the content of this event, if any
    replacingEventId?: string;

    // Helper to build permalinks for the room
    permalinkCreator?: RoomPermalinkCreator;

    // CallEventGrouper for this event
    callEventGrouper?: CallEventGrouper;

    // Symbol of the root node
    as?: string;

    // whether or not to always show timestamps
    alwaysShowTimestamps?: boolean;

    // whether or not to display the sender
    hideSender?: boolean;

    // whether or not to display thread info
    showThreadInfo?: boolean;

    timelineRenderingType?: TimelineRenderingType;

    // if specified and `true`, the message his behing
    // hidden for moderation from other users but is
    // displayed to the current user either because they're
    // the author or they are a moderator
    isSeeingThroughMessageHiddenForModeration?: boolean;
}

interface IState {
    // Whether the action bar is focused.
    actionBarFocused: boolean;
    // Whether all read receipts are being displayed. If not, only display
    // a truncation of them.
    allReadAvatars: boolean;
    // Whether the event's sender has been verified.
    verified: string;
    // Whether onRequestKeysClick has been called since mounting.
    previouslyRequestedKeys: boolean;
    // The Relations model from the JS SDK for reactions to `mxEvent`
    reactions: Relations;

    hover: boolean;
    isQuoteExpanded?: boolean;

    thread: Thread;
    threadReplyCount: number;
    threadLastReply: MatrixEvent;
    threadLastSender: RoomMember | null;
    threadNotification?: NotificationCountType;
}

@replaceableComponent("views.rooms.EventTile")
export default class EventTile extends React.Component<IProps, IState> {
    private suppressReadReceiptAnimation: boolean;
    private isListeningForReceipts: boolean;
    // TODO: Types
    private tile = React.createRef<unknown>();
    private replyChain = React.createRef<ReplyChain>();
    private threadState: ThreadNotificationState;

    public readonly ref = createRef<HTMLElement>();

    static defaultProps = {
        // no-op function because onHeightChanged is optional yet some sub-components assume its existence
        onHeightChanged: function() {},
        forExport: false,
        layout: Layout.Group,
    };

    static contextType = MatrixClientContext;
    public context!: React.ContextType<typeof MatrixClientContext>;

    constructor(props: IProps, context: React.ContextType<typeof MatrixClientContext>) {
        super(props, context);

        this.context = context;
        const thread = this.thread;

        this.state = {
            // Whether the action bar is focused.
            actionBarFocused: false,
            // Whether all read receipts are being displayed. If not, only display
            // a truncation of them.
            allReadAvatars: false,
            // Whether the event's sender has been verified.
            verified: null,
            // Whether onRequestKeysClick has been called since mounting.
            previouslyRequestedKeys: false,
            // The Relations model from the JS SDK for reactions to `mxEvent`
            reactions: this.getReactions(),

            hover: false,

            thread,
            threadReplyCount: thread?.length,
            threadLastReply: thread?.replyToEvent,
            threadLastSender: thread?.replyToEvent.sender,
        };

        // don't do RR animations until we are mounted
        this.suppressReadReceiptAnimation = true;

        // Throughout the component we manage a read receipt listener to see if our tile still
        // qualifies for a "sent" or "sending" state (based on their relevant conditions). We
        // don't want to over-subscribe to the read receipt events being fired, so we use a flag
        // to determine if we've already subscribed and use a combination of other flags to find
        // out if we should even be subscribed at all.
        this.isListeningForReceipts = false;
    }

    /**
     * When true, the tile qualifies for some sort of special read receipt. This could be a 'sending'
     * or 'sent' receipt, for example.
     * @returns {boolean}
     */
    private get isEligibleForSpecialReceipt(): boolean {
        // First, if there are other read receipts then just short-circuit this.
        if (this.props.readReceipts && this.props.readReceipts.length > 0) return false;
        if (!this.props.mxEvent) return false;

        // Sanity check (should never happen, but we shouldn't explode if it does)
        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        if (!room) return false;

        // Quickly check to see if the event was sent by us. If it wasn't, it won't qualify for
        // special read receipts.
        const myUserId = this.context.getUserId();
        if (this.props.mxEvent.getSender() !== myUserId) return false;

        // Finally, determine if the type is relevant to the user. This notably excludes state
        // events and pretty much anything that can't be sent by the composer as a message. For
        // those we rely on local echo giving the impression of things changing, and expect them
        // to be quick.
        const simpleSendableEvents = [
            EventType.Sticker,
            EventType.RoomMessage,
            EventType.RoomMessageEncrypted,
        ];
        if (!simpleSendableEvents.includes(this.props.mxEvent.getType() as EventType)) return false;

        // Default case
        return true;
    }

    private get shouldShowSentReceipt() {
        // If we're not even eligible, don't show the receipt.
        if (!this.isEligibleForSpecialReceipt) return false;

        // We only show the 'sent' receipt on the last successful event.
        if (!this.props.lastSuccessful) return false;

        // Check to make sure the sending state is appropriate. A null/undefined send status means
        // that the message is 'sent', so we're just double checking that it's explicitly not sent.
        if (this.props.eventSendStatus && this.props.eventSendStatus !== EventStatus.SENT) return false;

        // If anyone has read the event besides us, we don't want to show a sent receipt.
        const receipts = this.props.readReceipts || [];
        const myUserId = this.context.getUserId();
        if (receipts.some(r => r.userId !== myUserId)) return false;

        // Finally, we should show a receipt.
        return true;
    }

    private get shouldShowSendingReceipt() {
        // If we're not even eligible, don't show the receipt.
        if (!this.isEligibleForSpecialReceipt) return false;

        // Check the event send status to see if we are pending. Null/undefined status means the
        // message was sent, so check for that and 'sent' explicitly.
        if (!this.props.eventSendStatus || this.props.eventSendStatus === EventStatus.SENT) return false;

        // Default to showing - there's no other event properties/behaviours we care about at
        // this point.
        return true;
    }

    // TODO: [REACT-WARNING] Move into constructor
    // eslint-disable-next-line
    UNSAFE_componentWillMount() {
        this.verifyEvent(this.props.mxEvent);
    }

    componentDidMount() {
        this.suppressReadReceiptAnimation = false;
        const client = this.context;
        if (!this.props.forExport) {
            client.on("deviceVerificationChanged", this.onDeviceVerificationChanged);
            client.on("userTrustStatusChanged", this.onUserVerificationChanged);
            this.props.mxEvent.on("Event.decrypted", this.onDecrypted);
            DecryptionFailureTracker.instance.addVisibleEvent(this.props.mxEvent);
            if (this.props.showReactions) {
                this.props.mxEvent.on("Event.relationsCreated", this.onReactionsCreated);
            }

            if (this.shouldShowSentReceipt || this.shouldShowSendingReceipt) {
                client.on("Room.receipt", this.onRoomReceipt);
                this.isListeningForReceipts = true;
            }
        }

        if (SettingsStore.getValue("feature_thread")) {
            this.props.mxEvent.once(ThreadEvent.Ready, this.updateThread);
            this.props.mxEvent.on(ThreadEvent.Update, this.updateThread);

            if (this.thread) {
                this.setupNotificationListener(this.thread);
            }
        }

        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        room?.on(ThreadEvent.New, this.onNewThread);
    }

    private setupNotificationListener = (thread: Thread): void => {
        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        const notifications = RoomNotificationStateStore.instance.getThreadsRoomState(room);

        this.threadState = notifications.getThreadRoomState(thread);

        this.threadState.on(NotificationStateEvents.Update, this.onThreadStateUpdate);
        this.onThreadStateUpdate();
    };

    private onThreadStateUpdate = (): void => {
        let threadNotification = null;
        switch (this.threadState?.color) {
            case NotificationColor.Grey:
                threadNotification = NotificationCountType.Total;
                break;
            case NotificationColor.Red:
                threadNotification = NotificationCountType.Highlight;
                break;
        }

        this.setState({
            threadNotification,
        });
    };

    private updateThread = (thread: Thread) => {
        if (thread !== this.state.thread) {
            if (this.threadState) {
                this.threadState.off(NotificationStateEvents.Update, this.onThreadStateUpdate);
            }

            this.setupNotificationListener(thread);
        }

        this.setState({
            threadLastReply: thread?.replyToEvent,
            threadLastSender: thread?.replyToEvent?.sender,
            threadReplyCount: thread?.length,
            thread,
        });
    };

    // TODO: [REACT-WARNING] Replace with appropriate lifecycle event
    // eslint-disable-next-line
    UNSAFE_componentWillReceiveProps(nextProps: IProps) {
        // re-check the sender verification as outgoing events progress through
        // the send process.
        if (nextProps.eventSendStatus !== this.props.eventSendStatus) {
            this.verifyEvent(nextProps.mxEvent);
        }
    }

    shouldComponentUpdate(nextProps: IProps, nextState: IState): boolean {
        if (objectHasDiff(this.state, nextState)) {
            return true;
        }

        return !this.propsEqual(this.props, nextProps);
    }

    componentWillUnmount() {
        const client = this.context;
        client.removeListener("deviceVerificationChanged", this.onDeviceVerificationChanged);
        client.removeListener("userTrustStatusChanged", this.onUserVerificationChanged);
        client.removeListener("Room.receipt", this.onRoomReceipt);
        this.isListeningForReceipts = false;
        this.props.mxEvent.removeListener("Event.decrypted", this.onDecrypted);
        if (this.props.showReactions) {
            this.props.mxEvent.removeListener("Event.relationsCreated", this.onReactionsCreated);
        }
        if (SettingsStore.getValue("feature_thread")) {
            this.props.mxEvent.off(ThreadEvent.Ready, this.updateThread);
            this.props.mxEvent.off(ThreadEvent.Update, this.updateThread);
        }

        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        room?.off(ThreadEvent.New, this.onNewThread);
        if (this.threadState) {
            this.threadState.off(NotificationStateEvents.Update, this.onThreadStateUpdate);
        }
    }

    componentDidUpdate(prevProps: IProps, prevState: IState, snapshot) {
        // If we're not listening for receipts and expect to be, register a listener.
        if (!this.isListeningForReceipts && (this.shouldShowSentReceipt || this.shouldShowSendingReceipt)) {
            this.context.on("Room.receipt", this.onRoomReceipt);
            this.isListeningForReceipts = true;
        }
    }

    private onNewThread = (thread: Thread) => {
        if (thread.id === this.props.mxEvent.getId()) {
            this.updateThread(thread);
            const room = this.context.getRoom(this.props.mxEvent.getRoomId());
            room.off(ThreadEvent.New, this.onNewThread);
        }
    };

    private get thread(): Thread | null {
        if (!SettingsStore.getValue("feature_thread")) {
            return null;
        }

        /**
         * Accessing the threads value through the room due to a race condition
         * that will be solved when there are proper backend support for threads
         * We currently have no reliable way to discover than an event is a thread
         * when we are at the sync stage
         */
        const room = MatrixClientPeg.get().getRoom(this.props.mxEvent.getRoomId());
        const thread = room?.threads.get(this.props.mxEvent.getId());

        if (!thread || thread.length === 0) {
            return null;
        }

        return thread;
    }

    private renderThreadPanelSummary(): JSX.Element | null {
        if (!this.thread) {
            return null;
        }

        return <div className="mx_ThreadPanel_replies">
            <span className="mx_ThreadPanel_repliesSummary">
                { this.thread.length }
            </span>
            { this.renderThreadLastMessagePreview() }
        </div>;
    }

    private renderThreadLastMessagePreview(): JSX.Element | null {
        const { threadLastReply } = this.state;
        const threadMessagePreview = MessagePreviewStore.instance.generatePreviewForEvent(threadLastReply);

        const sender = this.thread.roomState.getSentinelMember(threadLastReply.getSender());
        return <>
            <MemberAvatar
                member={sender}
                fallbackUserId={threadLastReply.getSender()}
                width={24}
                height={24}
                className="mx_ThreadInfo_avatar"
            />
            { threadMessagePreview && (
                <div className="mx_ThreadInfo_content">
                    <span className="mx_ThreadInfo_message-preview">
                        { threadMessagePreview }
                    </span>
                </div>
            ) }
        </>;
    }

    private renderThreadInfo(): React.ReactNode {
        if (this.props.timelineRenderingType === TimelineRenderingType.Search && this.props.mxEvent.threadRootId) {
            return (
                <p className="mx_ThreadSummaryIcon">{ _t("From a thread") }</p>
            );
        } else if (this.state.threadReplyCount) {
            return (
                <CardContext.Consumer>
                    { context =>
                        <div
                            className="mx_ThreadInfo"
                            onClick={() => {
                                showThread({ rootEvent: this.props.mxEvent, push: context.isCard });
                            }}
                        >
                            <span className="mx_ThreadInfo_threads-amount">
                                { _t("%(count)s reply", {
                                    count: this.state.threadReplyCount,
                                }) }
                            </span>
                            { this.renderThreadLastMessagePreview() }
                        </div>
                    }
                </CardContext.Consumer>
            );
        }
    }

    private viewInRoom = (evt: ButtonEvent): void => {
        evt.preventDefault();
        evt.stopPropagation();
        dis.dispatch({
            action: Action.ViewRoom,
            event_id: this.props.mxEvent.getId(),
            highlighted: true,
            room_id: this.props.mxEvent.getRoomId(),
        });
    };

    private copyLinkToThread = async (evt: ButtonEvent): Promise<void> => {
        const { permalinkCreator, mxEvent } = this.props;
        const matrixToUrl = permalinkCreator.forEvent(mxEvent.getId());
        await copyPlaintext(matrixToUrl);
    };

    private onRoomReceipt = (ev: MatrixEvent, room: Room): void => {
        // ignore events for other rooms
        const tileRoom = this.context.getRoom(this.props.mxEvent.getRoomId());
        if (room !== tileRoom) return;

        if (!this.shouldShowSentReceipt && !this.shouldShowSendingReceipt && !this.isListeningForReceipts) {
            return;
        }

        // We force update because we have no state or prop changes to queue up, instead relying on
        // the getters we use here to determine what needs rendering.
        this.forceUpdate(() => {
            // Per elsewhere in this file, we can remove the listener once we will have no further purpose for it.
            if (!this.shouldShowSentReceipt && !this.shouldShowSendingReceipt) {
                this.context.removeListener("Room.receipt", this.onRoomReceipt);
                this.isListeningForReceipts = false;
            }
        });
    };

    /** called when the event is decrypted after we show it.
     */
    private onDecrypted = () => {
        // we need to re-verify the sending device.
        // (we call onHeightChanged in verifyEvent to handle the case where decryption
        // has caused a change in size of the event tile)
        this.verifyEvent(this.props.mxEvent);
        this.forceUpdate();
    };

    private onDeviceVerificationChanged = (userId: string, device: string): void => {
        if (userId === this.props.mxEvent.getSender()) {
            this.verifyEvent(this.props.mxEvent);
        }
    };

    private onUserVerificationChanged = (userId: string, _trustStatus: string): void => {
        if (userId === this.props.mxEvent.getSender()) {
            this.verifyEvent(this.props.mxEvent);
        }
    };

    private async verifyEvent(mxEvent: MatrixEvent): Promise<void> {
        if (!mxEvent.isEncrypted() || mxEvent.isRedacted()) {
            return;
        }

        const encryptionInfo = this.context.getEventEncryptionInfo(mxEvent);
        const senderId = mxEvent.getSender();
        const userTrust = this.context.checkUserTrust(senderId);

        if (encryptionInfo.mismatchedSender) {
            // something definitely wrong is going on here
            this.setState({
                verified: E2EState.Warning,
            }, this.props.onHeightChanged); // Decryption may have caused a change in size
            return;
        }

        if (!userTrust.isCrossSigningVerified()) {
            // user is not verified, so default to everything is normal
            this.setState({
                verified: E2EState.Normal,
            }, this.props.onHeightChanged); // Decryption may have caused a change in size
            return;
        }

        const eventSenderTrust = encryptionInfo.sender && this.context.checkDeviceTrust(
            senderId, encryptionInfo.sender.deviceId,
        );
        if (!eventSenderTrust) {
            this.setState({
                verified: E2EState.Unknown,
            }, this.props.onHeightChanged); // Decryption may have caused a change in size
            return;
        }

        if (!eventSenderTrust.isVerified()) {
            this.setState({
                verified: E2EState.Warning,
            }, this.props.onHeightChanged); // Decryption may have caused a change in size
            return;
        }

        if (!encryptionInfo.authenticated) {
            this.setState({
                verified: E2EState.Unauthenticated,
            }, this.props.onHeightChanged); // Decryption may have caused a change in size
            return;
        }

        this.setState({
            verified: E2EState.Verified,
        }, this.props.onHeightChanged); // Decryption may have caused a change in size
    }

    private propsEqual(objA: IProps, objB: IProps): boolean {
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (let i = 0; i < keysA.length; i++) {
            const key = keysA[i];

            if (!objB.hasOwnProperty(key)) {
                return false;
            }

            // need to deep-compare readReceipts
            if (key === 'readReceipts') {
                const rA = objA[key];
                const rB = objB[key];
                if (rA === rB) {
                    continue;
                }

                if (!rA || !rB) {
                    return false;
                }

                if (rA.length !== rB.length) {
                    return false;
                }
                for (let j = 0; j < rA.length; j++) {
                    if (rA[j].userId !== rB[j].userId) {
                        return false;
                    }
                    // one has a member set and the other doesn't?
                    if (rA[j].roomMember !== rB[j].roomMember) {
                        return false;
                    }
                }
            } else {
                if (objA[key] !== objB[key]) {
                    return false;
                }
            }
        }
        return true;
    }

    private shouldHighlight(): boolean {
        if (this.props.forExport) return false;
        if (this.props.tileShape === TileShape.Notif) return false;
        if (this.props.tileShape === TileShape.ThreadPanel) return false;

        const actions = this.context.getPushActionsForEvent(this.props.mxEvent.replacingEvent() || this.props.mxEvent);
        if (!actions || !actions.tweaks) { return false; }

        // don't show self-highlights from another of our clients
        if (this.props.mxEvent.getSender() === this.context.credentials.userId) {
            return false;
        }

        // don't show highlights in 1:1 rooms
        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        if (room && room.currentState.getJoinedMemberCount() === 2) {
            return false;
        }

        return actions.tweaks.highlight;
    }

    private toggleAllReadAvatars = () => {
        this.setState({
            allReadAvatars: !this.state.allReadAvatars,
        });
    };

    private getReadAvatars() {
        if (this.shouldShowSentReceipt || this.shouldShowSendingReceipt) {
            return <SentReceipt messageState={this.props.mxEvent.getAssociatedStatus()} />;
        }

        const MAX_READ_AVATARS = this.props.layout == Layout.Bubble
            ? 16
            : 5;

        // return early if there are no read receipts
        if (!this.props.readReceipts || this.props.readReceipts.length === 0) {
            // We currently must include `mx_EventTile_readAvatars` in the DOM
            // of all events, as it is the positioned parent of the animated
            // read receipts. We can't let it unmount when a receipt moves
            // events, so for now we mount it for all events. Without it, the
            // animation will start from the top of the timeline (because it
            // lost its container).
            // See also https://github.com/vector-im/element-web/issues/17561
            return (<span className="mx_EventTile_readAvatars" />);
        }

        const avatars = [];
        const receiptOffset = 15;
        let left = 0;

        const receipts = this.props.readReceipts;

        for (let i = 0; i < receipts.length; ++i) {
            const receipt = receipts[i];

            let hidden = true;
            if ((i < MAX_READ_AVATARS) || this.state.allReadAvatars) {
                hidden = false;
            }
            // TODO: we keep the extra read avatars in the dom to make animation simpler
            // we could optimise this to reduce the dom size.

            // If hidden, set offset equal to the offset of the final visible avatar or
            // else set it proportional to index
            if (this.props.layout === Layout.Bubble) {
                left = (hidden ? MAX_READ_AVATARS - 1 : i) * receiptOffset;
            } else {
                left = (hidden ? MAX_READ_AVATARS - 1 : i) * -receiptOffset;
            }

            const userId = receipt.userId;
            let readReceiptInfo: IReadReceiptInfo;

            if (this.props.readReceiptMap) {
                readReceiptInfo = this.props.readReceiptMap[userId];
                if (!readReceiptInfo) {
                    readReceiptInfo = {};
                    this.props.readReceiptMap[userId] = readReceiptInfo;
                }
            }

            // add to the start so the most recent is on the end (ie. ends up rightmost)
            avatars.unshift(
                <ReadReceiptMarker
                    key={userId}
                    member={receipt.roomMember}
                    fallbackUserId={userId}
                    leftOffset={left}
                    hidden={hidden}
                    readReceiptInfo={readReceiptInfo}
                    checkUnmounting={this.props.checkUnmounting}
                    suppressAnimation={this.suppressReadReceiptAnimation}
                    onClick={this.toggleAllReadAvatars}
                    timestamp={receipt.ts}
                    showTwelveHour={this.props.isTwelveHour}
                />,
            );
        }

        let remText: JSX.Element;
        if (!this.state.allReadAvatars) {
            const remainder = receipts.length - MAX_READ_AVATARS;

            let style;
            if (this.props.layout === Layout.Bubble) {
                style = { left: "calc(" + toRem(left) + " + " + receiptOffset + "px)" };
            } else {
                style = { right: "calc(" + toRem(-left) + " + " + receiptOffset + "px)" };
            }

            if (remainder > 0) {
                remText = <span className="mx_EventTile_readAvatarRemainder"
                    onClick={this.toggleAllReadAvatars}
                    style={style}
                    aria-live="off">{ remainder }+
                </span>;
            }
        }

        return <span className="mx_EventTile_readAvatars">
            { remText }
            { avatars }
        </span>;
    }

    private onSenderProfileClick = () => {
        if (!this.props.timelineRenderingType) return;
        dis.dispatch<ComposerInsertPayload>({
            action: Action.ComposerInsert,
            userId: this.props.mxEvent.getSender(),
            timelineRenderingType: this.props.timelineRenderingType,
        });
    };

    private onRequestKeysClick = () => {
        this.setState({
            // Indicate in the UI that the keys have been requested (this is expected to
            // be reset if the component is mounted in the future).
            previouslyRequestedKeys: true,
        });

        // Cancel any outgoing key request for this event and resend it. If a response
        // is received for the request with the required keys, the event could be
        // decrypted successfully.
        this.context.cancelAndResendEventRoomKeyRequest(this.props.mxEvent);
    };

    private onPermalinkClicked = e => {
        // This allows the permalink to be opened in a new tab/window or copied as
        // matrix.to, but also for it to enable routing within Element when clicked.
        e.preventDefault();
        dis.dispatch({
            action: Action.ViewRoom,
            event_id: this.props.mxEvent.getId(),
            highlighted: true,
            room_id: this.props.mxEvent.getRoomId(),
        });
    };

    private renderE2EPadlock() {
        const ev = this.props.mxEvent;

        // event could not be decrypted
        if (ev.getContent().msgtype === 'm.bad.encrypted') {
            return <E2ePadlockUndecryptable />;
        }

        // event is encrypted and not redacted, display padlock corresponding to whether or not it is verified
        if (ev.isEncrypted() && !ev.isRedacted()) {
            if (this.state.verified === E2EState.Normal) {
                return; // no icon if we've not even cross-signed the user
            } else if (this.state.verified === E2EState.Verified) {
                return; // no icon for verified
            } else if (this.state.verified === E2EState.Unauthenticated) {
                return (<E2ePadlockUnauthenticated />);
            } else if (this.state.verified === E2EState.Unknown) {
                return (<E2ePadlockUnknown />);
            } else {
                return (<E2ePadlockUnverified />);
            }
        }

        if (this.context.isRoomEncrypted(ev.getRoomId())) {
            // else if room is encrypted
            // and event is being encrypted or is not_sent (Unknown Devices/Network Error)
            if (ev.status === EventStatus.ENCRYPTING) {
                return;
            }
            if (ev.status === EventStatus.NOT_SENT) {
                return;
            }
            if (ev.isState()) {
                return; // we expect this to be unencrypted
            }
            if (ev.isRedacted()) {
                return; // we expect this to be unencrypted
            }
            // if the event is not encrypted, but it's an e2e room, show the open padlock
            return <E2ePadlockUnencrypted />;
        }

        // no padlock needed
        return null;
    }

    private onActionBarFocusChange = (actionBarFocused: boolean) => {
        this.setState({ actionBarFocused });
    };
    // TODO: Types
    private getTile: () => any | null = () => this.tile.current;

    private getReplyChain = () => this.replyChain.current;

    private getReactions = () => {
        if (
            !this.props.showReactions ||
            !this.props.getRelationsForEvent
        ) {
            return null;
        }
        const eventId = this.props.mxEvent.getId();
        return this.props.getRelationsForEvent(eventId, "m.annotation", "m.reaction");
    };

    private onReactionsCreated = (relationType: string, eventType: string) => {
        if (relationType !== "m.annotation" || eventType !== "m.reaction") {
            return;
        }
        this.props.mxEvent.removeListener("Event.relationsCreated", this.onReactionsCreated);
        this.setState({
            reactions: this.getReactions(),
        });
    };

    private setQuoteExpanded = (expanded: boolean) => {
        this.setState({
            isQuoteExpanded: expanded,
        });
    };

    /**
     * In some cases we can't use shouldHideEvent() since whether or not we hide
     * an event depends on other things that the event itself
     * @returns {boolean} true if event should be hidden
     */
    private shouldHideEvent(): boolean {
        // If the call was replaced we don't render anything since we render the other call
        if (this.props.callEventGrouper?.hangupReason === CallErrorCode.Replaced) return true;

        return false;
    }

    render() {
        const msgtype = this.props.mxEvent.getContent().msgtype;
        const eventType = this.props.mxEvent.getType() as EventType;
        const {
            tileHandler,
            isBubbleMessage,
            isInfoMessage,
            isLeftAlignedBubbleMessage,
            noBubbleEvent,
            isSeeingThroughMessageHiddenForModeration,
        } = getEventDisplayInfo(this.props.mxEvent, this.shouldHideEvent());
        const { isQuoteExpanded } = this.state;

        // This shouldn't happen: the caller should check we support this type
        // before trying to instantiate us
        if (!tileHandler) {
            const { mxEvent } = this.props;
            logger.warn(`Event type not supported: type:${eventType} isState:${mxEvent.isState()}`);
            return <div className="mx_EventTile mx_EventTile_info mx_MNoticeBody">
                <div className="mx_EventTile_line">
                    { _t('This event could not be displayed') }
                </div>
            </div>;
        }

        const EventTileType = sdk.getComponent(tileHandler);
        const isProbablyMedia = MediaEventHelper.isEligible(this.props.mxEvent);

        const lineClasses = classNames("mx_EventTile_line", {
            mx_EventTile_mediaLine: isProbablyMedia,
            mx_EventTile_image: (
                this.props.mxEvent.getType() === EventType.RoomMessage &&
                this.props.mxEvent.getContent().msgtype === MsgType.Image
            ),
            mx_EventTile_sticker: this.props.mxEvent.getType() === EventType.Sticker,
            mx_EventTile_emote: (
                this.props.mxEvent.getType() === EventType.RoomMessage &&
                this.props.mxEvent.getContent().msgtype === MsgType.Emote
            ),
        });

        const isSending = (['sending', 'queued', 'encrypting'].indexOf(this.props.eventSendStatus) !== -1);
        const isRedacted = isMessageEvent(this.props.mxEvent) && this.props.isRedacted;
        const isEncryptionFailure = this.props.mxEvent.isDecryptionFailure();

        const isOwnEvent = this.props.mxEvent?.sender?.userId === this.context.getUserId();

        const scBubbleEnabled = this.props.layout === Layout.Bubble
                // && this.props.tileShape !== TileShape.ReplyPreview && this.props.tileShape !== TileShape.Reply
                && this.props.tileShape !== TileShape.Notif && this.props.tileShape !== TileShape.FileGrid;
        const showRight = isOwnEvent && !this.props.singleSideBubbles;
        const showLeft = !isOwnEvent || this.props.singleSideBubbles;

        let isContinuation = this.props.continuation;
        if (!isInfoMessage && !isBubbleMessage && this.props.tileShape) {
            isContinuation = false;
        }

        const isEditing = !!this.props.editState;
        const classes = classNames({
            mx_EventTile_bubbleContainer: isBubbleMessage && this.props.layout != Layout.Bubble,
            mx_EventTile_leftAlignedBubble: isLeftAlignedBubbleMessage,
            mx_EventTile: true,
            mx_EventTile_isEditing: isEditing,
            mx_EventTile_info: isInfoMessage && this.props.layout !== Layout.Bubble,
            mx_EventTile_12hr: this.props.isTwelveHour,
            // Note: we keep the `sending` state class for tests, not for our styles
            mx_EventTile_sending: !isEditing && isSending,
            mx_EventTile_highlight: this.shouldHighlight(),
            mx_EventTile_selected: this.props.isSelectedEvent,
            mx_EventTile_continuation: isContinuation,
            mx_EventTile_last: this.props.last,
            mx_EventTile_lastInSection: this.props.lastInSection,
            mx_EventTile_contextual: this.props.contextual,
            mx_EventTile_actionBarFocused: this.state.actionBarFocused,
            mx_EventTile_verified: !isBubbleMessage && this.state.verified === E2EState.Verified,
            mx_EventTile_unverified: !isBubbleMessage && this.state.verified === E2EState.Warning,
            mx_EventTile_unknown: !isBubbleMessage && this.state.verified === E2EState.Unknown,
            mx_EventTile_bad: isEncryptionFailure,
            mx_EventTile_emote: msgtype === MsgType.Emote,
            sc_EventTile_bubbleContainer: scBubbleEnabled,
            mx_EventTile_noSender: this.props.hideSender,
            mx_EventTile_clamp: this.props.tileShape === TileShape.ThreadPanel,
            mx_EventTile_noBubble: noBubbleEvent,
        });

        // If the tile is in the Sending state, don't speak the message.
        const ariaLive = (this.props.eventSendStatus !== null) ? 'off' : undefined;

        let permalink = "#";
        if (this.props.permalinkCreator) {
            permalink = this.props.permalinkCreator.forEvent(this.props.mxEvent.getId());
        }

        // we can't use local echoes as scroll tokens, because their event IDs change.
        // Local echos have a send "status".
        const scrollToken = this.props.mxEvent.status
            ? undefined
            : this.props.mxEvent.getId();

        let avatar;
        let sender;
        let avatarSize;
        let needsSenderProfile;

        if (!isInfoMessage && scBubbleEnabled && showRight) {
            avatarSize = 0;
            needsSenderProfile = false;
        } else if (this.props.tileShape === TileShape.Notif || this.props.tileShape === TileShape.ThreadPanel) {
            avatarSize = 24;
            needsSenderProfile = true;
        } else if (tileHandler === 'messages.RoomCreate' || isBubbleMessage) {
            avatarSize = 0;
            needsSenderProfile = false;
        } else if (isInfoMessage) {
            // a small avatar, with no sender profile, for
            // joins/parts/etc
            avatarSize = 14;
            needsSenderProfile = false;
        } else if (this.props.layout == Layout.IRC) {
            avatarSize = 14;
            needsSenderProfile = true;
        } else if (
            (this.props.continuation && this.props.tileShape !== TileShape.FileGrid) ||
            eventType === EventType.CallInvite
        ) {
            // no avatar or sender profile for continuation messages and call tiles
            avatarSize = 0;
            needsSenderProfile = false;
        } else {
            avatarSize = 30;
            needsSenderProfile = true;
        }

        if (this.props.mxEvent.sender && avatarSize) {
            let member;
            // set member to receiver (target) if it is a 3PID invite
            // so that the correct avatar is shown as the text is
            // `$target accepted the invitation for $email`
            if (this.props.mxEvent.getContent().third_party_invite) {
                member = this.props.mxEvent.target;
            } else {
                member = this.props.mxEvent.sender;
            }
            avatar = (
                <div className="mx_EventTile_avatar">
                    <MemberAvatar
                        member={member}
                        width={avatarSize}
                        height={avatarSize}
                        viewUserOnClick={true}
                    />
                </div>
            );
        }

        if (needsSenderProfile && this.props.hideSender !== true) {
            if (!this.props.tileShape || this.props.tileShape === TileShape.Thread) {
                sender = <SenderProfile onClick={this.onSenderProfileClick}
                    mxEvent={this.props.mxEvent}
                    enableFlair={this.props.enableFlair}
                    userNameColorMode={this.props.userNameColorMode}
                    tileShape={this.props.tileShape}
                />;
            } else {
                sender = <SenderProfile
                    mxEvent={this.props.mxEvent}
                    enableFlair={this.props.enableFlair}
                    userNameColorMode={this.props.userNameColorMode}
                    tileShape={this.props.tileShape}
                />;
            }
        }

        const showMessageActionBar = !isEditing && !this.props.forExport;
        const actionBar = showMessageActionBar ? <MessageActionBar
            mxEvent={this.props.mxEvent}
            reactions={this.state.reactions}
            permalinkCreator={this.props.permalinkCreator}
            getTile={this.getTile}
            getReplyChain={this.getReplyChain}
            onFocusChange={this.onActionBarFocusChange}
            isQuoteExpanded={isQuoteExpanded}
            toggleThreadExpanded={() => this.setQuoteExpanded(!isQuoteExpanded)}
            getRelationsForEvent={this.props.getRelationsForEvent}
        /> : undefined;

        const showTimestamp = this.props.mxEvent.getTs()
            && (scBubbleEnabled
            || this.props.alwaysShowTimestamps
            || this.props.last
            || this.state.hover
            || this.state.actionBarFocused);

        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        const thread = room?.findThreadForEvent?.(this.props.mxEvent);

        // Thread panel shows the timestamp of the last reply in that thread
        const ts = this.props.tileShape !== TileShape.ThreadPanel
            ? this.props.mxEvent.getTs()
            : thread?.replyToEvent.getTs();

        const messageTimestamp = <MessageTimestamp
            showRelative={this.props.tileShape === TileShape.ThreadPanel}
            showTwelveHour={this.props.isTwelveHour}
            ts={ts}
        />;

        const timestamp = showTimestamp && ts ? messageTimestamp : null;

        const keyRequestHelpText =
            <div className="mx_EventTile_keyRequestInfo_tooltip_contents">
                <p>
                    { this.state.previouslyRequestedKeys ?
                        _t('Your key share request has been sent - please check your other sessions ' +
                           'for key share requests.') :
                        _t('Key share requests are sent to your other sessions automatically. If you ' +
                           'rejected or dismissed the key share request on your other sessions, click ' +
                           'here to request the keys for this session again.')
                    }
                </p>
                <p>
                    { _t('If your other sessions do not have the key for this message you will not ' +
                         'be able to decrypt them.')
                    }
                </p>
            </div>;
        const keyRequestInfoContent = this.state.previouslyRequestedKeys ?
            _t('Key request sent.') :
            _t(
                '<requestLink>Re-request encryption keys</requestLink> from your other sessions.',
                {},
                {
                    'requestLink': (sub) =>
                        <AccessibleButton
                            className="mx_EventTile_rerequestKeysCta"
                            kind='link_inline'
                            tabIndex={0}
                            onClick={this.onRequestKeysClick}
                        >
                            { sub }
                        </AccessibleButton>,
                },
            );

        const keyRequestInfo = isEncryptionFailure && !isRedacted ?
            <div className="mx_EventTile_keyRequestInfo">
                <span className="mx_EventTile_keyRequestInfo_text">
                    { keyRequestInfoContent }
                </span>
                <TooltipButton helpText={keyRequestHelpText} />
            </div> : null;

        let reactionsRow;
        if (!isRedacted) {
            reactionsRow = <ReactionsRow
                mxEvent={this.props.mxEvent}
                reactions={this.state.reactions}
            />;
        }

        const linkedTimestamp = <a className="sc_LinkedTimestamp"
            href={permalink}
            onClick={this.onPermalinkClicked}
            aria-label={formatTime(new Date(this.props.mxEvent.getTs()), this.props.isTwelveHour)}
        >
            { timestamp }
        </a>;

        const placeholderTimestamp = <span className="sc_PlaceholderTimestamp">
            { timestamp }
        </span>;

        const useIRCLayout = this.props.layout === Layout.IRC;
        const groupTimestamp = !useIRCLayout ? linkedTimestamp : null;
        const ircTimestamp = useIRCLayout ? linkedTimestamp : null;
        const bubbleTimestamp = this.props.layout === Layout.Bubble ? messageTimestamp : null;
        const groupPadlock = !useIRCLayout && !isBubbleMessage && this.renderE2EPadlock();
        const ircPadlock = useIRCLayout && !isBubbleMessage && this.renderE2EPadlock();

        const msgOptionClasses = classNames(
            "mx_EventTile_msgOption",
            {
                "sc_readReceipts_empty": (
                    // Don't reserve space below bubbles if there are no read receipts
                    (!this.props.readReceipts || this.props.readReceipts.length === 0) &&
                    // ToDo: Maybe incorporate sent/sending state into bubble?!?
                    !(this.shouldShowSentReceipt || this.shouldShowSendingReceipt)
                ),
            },
        );

        let msgOption;
        if (this.props.showReadReceipts) {
            const readAvatars = this.getReadAvatars();
            msgOption = (
                <div className={msgOptionClasses}>
                    { readAvatars }
                </div>
            );
        }

        const renderTarget = this.props.tileShape === TileShape.Thread
            ? RelationType.Thread
            : undefined;

        const replyChain = haveTileForEvent(this.props.mxEvent)
            && ReplyChain.shouldDisplayReply(this.props.mxEvent, renderTarget)
            ? <ReplyChain
                parentEv={this.props.mxEvent}
                onHeightChanged={this.props.onHeightChanged}
                ref={this.replyChain}
                forExport={this.props.forExport}
                permalinkCreator={this.props.permalinkCreator}
                layout={this.props.layout}
                userNameColorMode={this.props.userNameColorMode}
                alwaysShowTimestamps={this.props.alwaysShowTimestamps || this.state.hover}
                isQuoteExpanded={isQuoteExpanded}
                setQuoteExpanded={this.setQuoteExpanded}
                getRelationsForEvent={this.props.getRelationsForEvent}
            />
            : null;

        switch (this.props.tileShape) {
            case TileShape.Notif: {
                const room = this.context.getRoom(this.props.mxEvent.getRoomId());
                return React.createElement(this.props.as || "li", {
                    "className": classes,
                    "aria-live": ariaLive,
                    "aria-atomic": true,
                    "data-scroll-tokens": scrollToken,
                }, [
                    <div className="mx_EventTile_roomName" key="mx_EventTile_roomName">
                        <RoomAvatar room={room} width={28} height={28} />
                        <a href={permalink} onClick={this.onPermalinkClicked}>
                            { room ? room.name : '' }
                        </a>
                    </div>,
                    <div className="mx_EventTile_senderDetails" key="mx_EventTile_senderDetails">
                        { avatar }
                        <a href={permalink} onClick={this.onPermalinkClicked}>
                            { sender }
                            { timestamp }
                        </a>
                    </div>,
                    <div className={lineClasses} key="mx_EventTile_line">
                        <EventTileType ref={this.tile}
                            mxEvent={this.props.mxEvent}
                            highlights={this.props.highlights}
                            highlightLink={this.props.highlightLink}
                            showUrlPreview={this.props.showUrlPreview}
                            onHeightChanged={this.props.onHeightChanged}
                            tileShape={this.props.tileShape}
                            editState={this.props.editState}
                            getRelationsForEvent={this.props.getRelationsForEvent}
                            isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                            youtubeEmbedPlayer={this.props.youtubeEmbedPlayer}
                        />
                    </div>,
                ]);
            }
            case TileShape.Thread: {
                const room = this.context.getRoom(this.props.mxEvent.getRoomId());
                return React.createElement(this.props.as || "li", {
                    "ref": this.ref,
                    "className": classes,
                    "aria-live": ariaLive,
                    "aria-atomic": true,
                    "data-scroll-tokens": scrollToken,
                    "data-has-reply": !!replyChain,
                    "data-layout": this.props.layout,
                    "data-self": isOwnEvent,
                    "onMouseEnter": () => this.setState({ hover: true }),
                    "onMouseLeave": () => this.setState({ hover: false }),
                }, [
                    <div className="mx_EventTile_roomName" key="mx_EventTile_roomName">
                        <RoomAvatar room={room} width={28} height={28} />
                        <a href={permalink} onClick={this.onPermalinkClicked}>
                            { room ? room.name : '' }
                        </a>
                    </div>,
                    <div className="mx_EventTile_senderDetails" key="mx_EventTile_senderDetails">
                        { avatar }
                        <a href={permalink} onClick={this.onPermalinkClicked}>
                            { sender }
                        </a>
                    </div>,
                    <div className={lineClasses} key="mx_EventTile_line">
                        { replyChain }
                        <EventTileType ref={this.tile}
                            mxEvent={this.props.mxEvent}
                            highlights={this.props.highlights}
                            highlightLink={this.props.highlightLink}
                            showUrlPreview={this.props.showUrlPreview}
                            onHeightChanged={this.props.onHeightChanged}
                            tileShape={this.props.tileShape}
                            editState={this.props.editState}
                            replacingEventId={this.props.replacingEventId}
                            getRelationsForEvent={this.props.getRelationsForEvent}
                            isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                            youtubeEmbedPlayer={this.props.youtubeEmbedPlayer}
                        />
                        { actionBar }
                        { timestamp }
                    </div>,
                    reactionsRow,
                ]);
            }
            case TileShape.ThreadPanel: {
                // tab-index=-1 to allow it to be focusable but do not add tab stop for it, primarily for screen readers
                return (
                    React.createElement(this.props.as || "li", {
                        "ref": this.ref,
                        "className": classes,
                        "tabIndex": -1,
                        "aria-live": ariaLive,
                        "aria-atomic": "true",
                        "data-scroll-tokens": scrollToken,
                        "data-layout": this.props.layout,
                        "data-shape": this.props.tileShape,
                        "data-self": isOwnEvent,
                        "data-has-reply": !!replyChain,
                        "data-notification": this.state.threadNotification,
                        "onMouseEnter": () => this.setState({ hover: true }),
                        "onMouseLeave": () => this.setState({ hover: false }),
                        "onClick": () => showThread({ rootEvent: this.props.mxEvent, push: true }),
                    }, <>
                        { sender }
                        { avatar }
                        { timestamp }
                        <div
                            className={lineClasses}
                            key="mx_EventTile_line"
                        >
                            { this.renderE2EPadlock() }
                            <div className="mx_EventTile_body">
                                { this.props.mxEvent.isRedacted()
                                    ? <RedactedBody mxEvent={this.props.mxEvent} />
                                    : MessagePreviewStore.instance.generatePreviewForEvent(this.props.mxEvent)
                                }
                            </div>
                            { this.renderThreadPanelSummary() }
                        </div>
                        <Toolbar className="mx_MessageActionBar" aria-label={_t("Message Actions")} aria-live="off">
                            <RovingAccessibleTooltipButton
                                className="mx_MessageActionBar_maskButton mx_MessageActionBar_viewInRoom"
                                onClick={this.viewInRoom}
                                title={_t("View in room")}
                                key="view_in_room"
                            />
                            <RovingAccessibleTooltipButton
                                className="mx_MessageActionBar_maskButton mx_MessageActionBar_copyLinkToThread"
                                onClick={this.copyLinkToThread}
                                title={_t("Copy link to thread")}
                                key="copy_link_to_thread"
                            />
                        </Toolbar>
                        { msgOption }
                    </>)
                );
            }
            case TileShape.FileGrid: {
                return React.createElement(this.props.as || "li", {
                    "className": classes,
                    "aria-live": ariaLive,
                    "aria-atomic": true,
                    "data-scroll-tokens": scrollToken,
                }, [
                    <div className={lineClasses} key="mx_EventTile_line">
                        <EventTileType ref={this.tile}
                            mxEvent={this.props.mxEvent}
                            highlights={this.props.highlights}
                            highlightLink={this.props.highlightLink}
                            showUrlPreview={this.props.showUrlPreview}
                            tileShape={this.props.tileShape}
                            onHeightChanged={this.props.onHeightChanged}
                            editState={this.props.editState}
                            getRelationsForEvent={this.props.getRelationsForEvent}
                            isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                            youtubeEmbedPlayer={this.props.youtubeEmbedPlayer}
                        />
                    </div>,
                    <a
                        className="mx_EventTile_senderDetailsLink"
                        key="mx_EventTile_senderDetailsLink"
                        href={permalink}
                        onClick={this.onPermalinkClicked}
                    >
                        <div className="mx_EventTile_senderDetails">
                            { sender }
                            { timestamp }
                        </div>
                    </a>,
                ]);
            }

            default: {
                const isOwnEvent = this.props.mxEvent?.sender?.userId === MatrixClientPeg.get().getUserId();

                if (scBubbleEnabled) {
                    const infoBubble = isInfoMessage || isBubbleMessage;

                    const mediaBodyTypes = ['m.image', /* 'm.file', */ /* 'm.audio', */ 'm.video'];
                    const mediaEvTypes = ['m.sticker'];
                    let mediaBody = false;
                    let stickerBody = false;
                    let noticeBody = false;

                    const content = this.props.mxEvent.getContent();
                    const type = this.props.mxEvent.getType();
                    const msgtype = content.msgtype;

                    if (msgtype && mediaBodyTypes.indexOf(msgtype) != -1) {
                        mediaBody = true;
                    }

                    if (type && mediaEvTypes.indexOf(type) != -1) {
                        mediaBody = true;
                        stickerBody = true;
                    }

                    if (msgtype && msgtype == 'm.notice') noticeBody = true;

                    const bubbleLineClasses = classNames(
                        "sc_EventTile_bubbleLine",
                        {
                            "sc_EventTile_bubbleLine_info": infoBubble,
                        },
                    );
                    const bubbleAreaClasses = classNames(
                        "sc_EventTile_bubbleArea",
                        {
                            "sc_EventTile_bubbleArea_right": !infoBubble && showRight,
                            "sc_EventTile_bubbleArea_left": !infoBubble && showLeft,
                            "sc_EventTile_bubbleArea_center": infoBubble,
                            "sc_EventTile_bubbleArea_info": infoBubble,
                        },
                    );
                    const bubbleClasses = classNames(
                        {
                            "sc_EventTile_bubble": !mediaBody,
                            "sc_EventTile_bubble_media": mediaBody,
                            "sc_EventTile_bubble_info": infoBubble,
                            "sc_EventTile_bubble_self": !infoBubble && isOwnEvent,
                            "sc_EventTile_bubble_right": !infoBubble && showRight,
                            "sc_EventTile_bubble_left": !infoBubble && showLeft,
                            "sc_EventTile_bubble_center": infoBubble,
                            "sc_EventTile_bubble_tail": !infoBubble && !this.props.continuation,
                            "sc_EventTile_bubble_notice": noticeBody,
                            "sc_EventTile_bubble_sticker": stickerBody,
                        },
                    );

                    // tab-index=-1 to allow it to be focusable but do not add tab stop for it, primarily for screen readers
                    return (
                        React.createElement(this.props.as || "li", {
                            "ref": this.ref,
                            "className": classes,
                            "tabIndex": -1,
                            "aria-live": ariaLive,
                            "aria-atomic": "true",
                            "data-scroll-tokens": scrollToken,
                            "data-layout": this.props.layout,
                            "data-self": isOwnEvent,
                            "data-has-reply": !!replyChain,
                            "onMouseEnter": () => this.setState({ hover: true }),
                            "onMouseLeave": () => this.setState({ hover: false }),
                        }, <>
                            <div className={`${lineClasses} ${bubbleLineClasses}`} key="mx_EventTile_line">
                                { groupPadlock }
                                <div className={bubbleAreaClasses}>
                                    <div className={bubbleClasses}>
                                        { sender }
                                        { replyChain }
                                        { infoBubble ? avatar : null }
                                        <EventTileType
                                            ref={this.tile}
                                            mxEvent={this.props.mxEvent}
                                            forExport={this.props.forExport}
                                            replacingEventId={this.props.replacingEventId}
                                            editState={this.props.editState}
                                            highlights={this.props.highlights}
                                            highlightLink={this.props.highlightLink}
                                            showUrlPreview={this.props.showUrlPreview}
                                            onHeightChanged={this.props.onHeightChanged}
                                            callEventGrouper={this.props.callEventGrouper}
                                            getRelationsForEvent={this.props.getRelationsForEvent}
                                            isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                                            // timestamp={bubbleTimestamp}
                                            layout={this.props.layout}
                                            scBubble={true}
                                            scBubbleActionBar={mediaBody ? actionBar : null}
                                            scBubbleGroupTimestamp={<>{ placeholderTimestamp }{ linkedTimestamp }</>}
                                            youtubeEmbedPlayer={this.props.youtubeEmbedPlayer}
                                        />
                                        { !mediaBody ? actionBar : null }
                                    </div>
                                    { keyRequestInfo }
                                    { reactionsRow }
                                    { this.renderThreadInfo() }
                                </div>
                            </div>
                            { !infoBubble ? avatar : null }
                            { msgOption }
                        </>)
                    );
                } else {
                    // tab-index=-1 to allow it to be focusable but do not add tab stop for it, primarily for screen readers
                    return (
                        React.createElement(this.props.as || "li", {
                            "ref": this.ref,
                            "className": classes,
                            "tabIndex": -1,
                            "aria-live": ariaLive,
                            "aria-atomic": "true",
                            "data-scroll-tokens": scrollToken,
                            "data-layout": this.props.layout,
                            "data-self": isOwnEvent,
                            "data-has-reply": !!replyChain,
                            "onMouseEnter": () => this.setState({ hover: true }),
                            "onMouseLeave": () => this.setState({ hover: false }),
                        }, <>
                            { ircTimestamp }
                            { sender }
                            { ircPadlock }
                            { avatar }
                            <div className={lineClasses} key="mx_EventTile_line">
                                { groupTimestamp }
                                { groupPadlock }
                                { replyChain }
                                <EventTileType
                                    ref={this.tile}
                                    mxEvent={this.props.mxEvent}
                                    forExport={this.props.forExport}
                                    replacingEventId={this.props.replacingEventId}
                                    editState={this.props.editState}
                                    highlights={this.props.highlights}
                                    highlightLink={this.props.highlightLink}
                                    showUrlPreview={this.props.showUrlPreview}
                                    permalinkCreator={this.props.permalinkCreator}
                                    onHeightChanged={this.props.onHeightChanged}
                                    callEventGrouper={this.props.callEventGrouper}
                                    getRelationsForEvent={this.props.getRelationsForEvent}
                                    isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                                    timestamp={bubbleTimestamp}
                                    youtubeEmbedPlayer={this.props.youtubeEmbedPlayer}
                                />
                                { keyRequestInfo }
                                { actionBar }
                                { this.props.layout === Layout.IRC && <>
                                    { reactionsRow }
                                    { this.renderThreadInfo() }
                                </> }
                            </div>
                            { this.props.layout !== Layout.IRC && <>
                                { reactionsRow }
                                { this.renderThreadInfo() }
                            </> }
                            { msgOption }
                        </>)
                    );
                }
            }
        }
    }
}

// XXX this'll eventually be dynamic based on the fields once we have extensible event types
const messageTypes = ['m.room.message', 'm.sticker'];
function isMessageEvent(ev: MatrixEvent): boolean {
    return (messageTypes.includes(ev.getType()));
}

export function haveTileForEvent(e: MatrixEvent, showHiddenEvents?: boolean): boolean {
    // Only show "Message deleted" tile for message or encrypted events
    if (e.isRedacted() && !e.isEncrypted() && !isMessageEvent(e)) return false;

    // No tile for replacement events since they update the original tile
    if (e.isRelation("m.replace")) return false;

    const handler = getHandlerTile(e);
    if (handler === undefined) return false;
    if (handler === 'messages.TextualEvent') {
        return hasText(e, showHiddenEvents);
    } else if (handler === 'messages.RoomCreate') {
        return Boolean(e.getContent()['predecessor']);
    } else {
        return true;
    }
}

function E2ePadlockUndecryptable(props) {
    return (
        <E2ePadlock title={_t("This message cannot be decrypted")} icon={E2ePadlockIcon.Warning} {...props} />
    );
}

function E2ePadlockUnverified(props) {
    return (
        <E2ePadlock title={_t("Encrypted by an unverified session")} icon={E2ePadlockIcon.Warning} {...props} />
    );
}

function E2ePadlockUnencrypted(props) {
    return (
        <E2ePadlock title={_t("Unencrypted")} icon={E2ePadlockIcon.Warning} {...props} />
    );
}

function E2ePadlockUnknown(props) {
    return (
        <E2ePadlock title={_t("Encrypted by a deleted session")} icon={E2ePadlockIcon.Normal} {...props} />
    );
}

function E2ePadlockUnauthenticated(props) {
    return (
        <E2ePadlock
            title={_t("The authenticity of this encrypted message can't be guaranteed on this device.")}
            icon={E2ePadlockIcon.Normal}
            {...props}
        />
    );
}

enum E2ePadlockIcon {
    Normal = "normal",
    Warning = "warning",
}

interface IE2ePadlockProps {
    icon: E2ePadlockIcon;
    title: string;
}

interface IE2ePadlockState {
    hover: boolean;
}

class E2ePadlock extends React.Component<IE2ePadlockProps, IE2ePadlockState> {
    constructor(props: IE2ePadlockProps) {
        super(props);

        this.state = {
            hover: false,
        };
    }

    private onHoverStart = (): void => {
        this.setState({ hover: true });
    };

    private onHoverEnd = (): void => {
        this.setState({ hover: false });
    };

    public render(): JSX.Element {
        let tooltip = null;
        if (this.state.hover) {
            tooltip = <Tooltip className="mx_EventTile_e2eIcon_tooltip" label={this.props.title} />;
        }

        const classes = `mx_EventTile_e2eIcon mx_EventTile_e2eIcon_${this.props.icon}`;
        return (
            <div
                className={classes}
                onMouseEnter={this.onHoverStart}
                onMouseLeave={this.onHoverEnd}
            >{ tooltip }</div>
        );
    }
}

interface ISentReceiptProps {
    messageState: string; // TODO: Types for message sending state
}

interface ISentReceiptState {
    hover: boolean;
}

class SentReceipt extends React.PureComponent<ISentReceiptProps, ISentReceiptState> {
    constructor(props) {
        super(props);

        this.state = {
            hover: false,
        };
    }

    onHoverStart = () => {
        this.setState({ hover: true });
    };

    onHoverEnd = () => {
        this.setState({ hover: false });
    };

    render() {
        const isSent = !this.props.messageState || this.props.messageState === 'sent';
        const isFailed = this.props.messageState === 'not_sent';
        const receiptClasses = classNames({
            'mx_EventTile_receiptSent': isSent,
            'mx_EventTile_receiptSending': !isSent && !isFailed,
        });

        let nonCssBadge = null;
        if (isFailed) {
            nonCssBadge = <NotificationBadge
                notification={StaticNotificationState.RED_EXCLAMATION}
            />;
        }

        let tooltip = null;
        if (this.state.hover) {
            let label = _t("Sending your message...");
            if (this.props.messageState === 'encrypting') {
                label = _t("Encrypting your message...");
            } else if (isSent) {
                label = _t("Your message was sent");
            } else if (isFailed) {
                label = _t("Failed to send");
            }
            // The yOffset is somewhat arbitrary - it just brings the tooltip down to be more associated
            // with the read receipt.
            tooltip = <Tooltip className="mx_EventTile_readAvatars_receiptTooltip" label={label} yOffset={3} />;
        }

        return <span className="mx_EventTile_readAvatars">
            <span className={receiptClasses} onMouseEnter={this.onHoverStart} onMouseLeave={this.onHoverEnd}>
                { nonCssBadge }
                { tooltip }
            </span>
        </span>;
    }
}
