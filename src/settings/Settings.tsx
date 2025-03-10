/*
Copyright 2017 Travis Ralston
Copyright 2018 - 2021 The Matrix.org Foundation C.I.C.

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

import { MatrixClient } from 'matrix-js-sdk/src/client';
import React, { ReactNode } from "react";

import { _t, _td } from '../languageHandler';
import {
    NotificationBodyEnabledController,
    NotificationsEnabledController,
} from "./controllers/NotificationControllers";
import CustomStatusController from "./controllers/CustomStatusController";
import ThemeController from './controllers/ThemeController';
import PushToMatrixClientController from './controllers/PushToMatrixClientController';
import ReloadOnChangeController from "./controllers/ReloadOnChangeController";
import FontSizeController from './controllers/FontSizeController';
import SystemFontController from './controllers/SystemFontController';
import UseSystemFontController from './controllers/UseSystemFontController';
import { SettingLevel } from "./SettingLevel";
import SettingController from "./controllers/SettingController";
import { isMac } from '../Keyboard';
import UIFeatureController from "./controllers/UIFeatureController";
import { UIFeature } from "./UIFeature";
import { OrderedMultiController } from "./controllers/OrderedMultiController";
import { Layout } from "./enums/Layout";
import ReducedMotionController from './controllers/ReducedMotionController';
import IncompatibleController from "./controllers/IncompatibleController";
import { Theme } from './enums/Theme';
import { UserNameColorMode } from './enums/UserNameColorMode';
import { RoomListStyle } from './enums/RoomListStyle';
import { ImageSize } from "./enums/ImageSize";
import { MetaSpace } from "../stores/spaces";
import SdkConfig from "../SdkConfig";

// These are just a bunch of helper arrays to avoid copy/pasting a bunch of times
const LEVELS_ROOM_SETTINGS = [
    SettingLevel.DEVICE,
    SettingLevel.ROOM_DEVICE,
    SettingLevel.ROOM_ACCOUNT,
    SettingLevel.ACCOUNT,
    SettingLevel.CONFIG,
];
const LEVELS_ROOM_OR_ACCOUNT = [
    SettingLevel.ROOM_ACCOUNT,
    SettingLevel.ACCOUNT,
];
const LEVELS_ROOM_SETTINGS_WITH_ROOM = [
    SettingLevel.DEVICE,
    SettingLevel.ROOM_DEVICE,
    SettingLevel.ROOM_ACCOUNT,
    SettingLevel.ACCOUNT,
    SettingLevel.CONFIG,
    SettingLevel.ROOM,
];
const LEVELS_ACCOUNT_SETTINGS = [
    SettingLevel.DEVICE,
    SettingLevel.ACCOUNT,
    SettingLevel.CONFIG,
];
const LEVELS_FEATURE = [
    SettingLevel.DEVICE,
    SettingLevel.CONFIG,
];
const LEVELS_DEVICE_ONLY_SETTINGS = [
    SettingLevel.DEVICE,
];
const LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG = [
    SettingLevel.DEVICE,
    SettingLevel.CONFIG,
];
const LEVELS_UI_FEATURE = [
    SettingLevel.CONFIG,
    // in future we might have a .well-known level or something
];

export enum LabGroup {
    Messaging,
    Profile,
    Spaces,
    Widgets,
    Rooms,
    Moderation,
    Analytics,
    MessagePreviews,
    Themes,
    Encryption,
    Experimental,
    Developer,
}

export const labGroupNames: Record<LabGroup, string> = {
    [LabGroup.Messaging]: _td("Messaging"),
    [LabGroup.Profile]: _td("Profile"),
    [LabGroup.Spaces]: _td("Spaces"),
    [LabGroup.Widgets]: _td("Widgets"),
    [LabGroup.Rooms]: _td("Rooms"),
    [LabGroup.Moderation]: _td("Moderation"),
    [LabGroup.Analytics]: _td("Analytics"),
    [LabGroup.MessagePreviews]: _td("Message Previews"),
    [LabGroup.Themes]: _td("Themes"),
    [LabGroup.Encryption]: _td("Encryption"),
    [LabGroup.Experimental]: _td("Experimental"),
    [LabGroup.Developer]: _td("Developer"),
};

interface IBaseSetting {
    isFeature?: false | undefined;

    // Display names are strongly recommended for clarity.
    // Display name can also be an object for different levels.
    displayName?: string | {
        // @ts-ignore - TS wants the key to be a string, but we know better
        [level: SettingLevel]: string;
    };

    // Optional description which will be shown as microCopy under SettingsFlags
    description?: string;

    // The supported levels are required. Preferably, use the preset arrays
    // at the top of this file to define this rather than a custom array.
    supportedLevels?: SettingLevel[];

    // Required. Can be any data type. The value specified here should match
    // the data being stored (ie: if a boolean is used, the setting should
    // represent a boolean).
    default: any;

    // Optional settings controller. See SettingsController for more information.
    controller?: SettingController;

    // Optional flag to make supportedLevels be respected as the order to handle
    // settings. The first element is treated as "most preferred". The "default"
    // level is always appended to the end.
    supportedLevelsAreOrdered?: boolean;

    // Optional value to invert a boolean setting's value. The string given will
    // be read as the setting's ID instead of the one provided as the key for the
    // setting definition. By setting this, the returned value will automatically
    // be inverted, except for when the default value is returned. Inversion will
    // occur after the controller is asked for an override. This should be used by
    // historical settings which we don't want existing user's values be wiped. Do
    // not use this for new settings.
    invertedSettingName?: string;

    // XXX: Keep this around for re-use in future Betas
    betaInfo?: {
        title: string; // _td
        caption: () => ReactNode;
        disclaimer?: (enabled: boolean) => ReactNode;
        image: string; // require(...)
        feedbackSubheading?: string;
        feedbackLabel?: string;
        extraSettings?: string[];
        requiresRefresh?: boolean;
    };
}

export interface IFeature extends Omit<IBaseSetting, "isFeature"> {
    // Must be set to true for features.
    isFeature: true;
    labsGroup: LabGroup;
}

// Type using I-identifier for backwards compatibility from before it became a discriminated union
export type ISetting = IBaseSetting | IFeature;

export const SETTINGS: {[setting: string]: ISetting} = {
    "feature_msc3531_hide_messages_pending_moderation": {
        isFeature: true,
        labsGroup: LabGroup.Moderation,
        displayName: _td("Let moderators hide messages pending moderation."),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_report_to_moderators": {
        isFeature: true,
        labsGroup: LabGroup.Moderation,
        displayName: _td("Report to moderators prototype. " +
            "In rooms that support moderation, the `report` button will let you report abuse to room moderators"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_dnd": {
        isFeature: true,
        labsGroup: LabGroup.Profile,
        displayName: _td("Show options to enable 'Do not disturb' mode"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_latex_maths": {
        isFeature: true,
        labsGroup: LabGroup.Messaging,
        displayName: _td("Render LaTeX maths in messages"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_mark_unread": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        displayName: _td("Mark rooms as unread"),
        supportedLevels: LEVELS_FEATURE,
        default: true,
    },
    "feature_communities_v2_prototypes": {
        isFeature: true,
        labsGroup: LabGroup.Spaces,
        displayName: _td(
            "Communities v2 prototypes. Requires compatible homeserver. " +
            "Highly experimental - use with caution.",
        ),
        supportedLevels: LEVELS_FEATURE,
        default: false,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", false, false),
    },
    "feature_pinning": {
        isFeature: true,
        labsGroup: LabGroup.Messaging,
        displayName: _td("Message Pinning"),
        supportedLevels: LEVELS_FEATURE,
        default: true,
    },
    "feature_thread": {
        isFeature: true,
        labsGroup: LabGroup.Messaging,
        // Requires a reload as we change an option flag on the `js-sdk`
        // And the entire sync history needs to be parsed again
        controller: new ReloadOnChangeController(),
        displayName: _td("Threaded messaging"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_custom_status": {
        isFeature: true,
        labsGroup: LabGroup.Profile,
        displayName: _td("Custom user status messages"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
        controller: new CustomStatusController(),
    },
    "feature_custom_tags": {
        isFeature: true,
        labsGroup: LabGroup.Experimental,
        displayName: _td("Group & filter rooms by custom tags (refresh to apply changes)"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", false, false),
    },
    "feature_state_counters": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        displayName: _td("Render simple counters in room header"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_many_integration_managers": {
        isFeature: true,
        labsGroup: LabGroup.Experimental,
        displayName: _td("Multiple integration managers (requires manual setup)"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_mjolnir": {
        isFeature: true,
        labsGroup: LabGroup.Moderation,
        displayName: _td("Try out new ways to ignore people (experimental)"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_custom_themes": {
        isFeature: true,
        labsGroup: LabGroup.Themes,
        displayName: _td("Support adding custom themes"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "feature_roomlist_preview_reactions_dms": {
        isFeature: true,
        labsGroup: LabGroup.MessagePreviews,
        displayName: _td("Show message previews for reactions in DMs"),
        supportedLevels: LEVELS_FEATURE,
        default: true,
        // this option is a subset of `feature_roomlist_preview_reactions_all` so disable it when that one is enabled
        controller: new IncompatibleController("feature_roomlist_preview_reactions_all"),
    },
    "feature_roomlist_preview_reactions_all": {
        isFeature: true,
        labsGroup: LabGroup.MessagePreviews,
        displayName: _td("Show message previews for reactions in all rooms"),
        supportedLevels: LEVELS_FEATURE,
        default: true,
    },
    "feature_dehydration": {
        isFeature: true,
        labsGroup: LabGroup.Encryption,
        displayName: _td("Offline encrypted messaging using dehydrated devices"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "scShowUpdateAnnouncementRoomToast": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: true,
    },
    "feature_extensible_events": {
        isFeature: true,
        labsGroup: LabGroup.Developer, // developer for now, eventually Messaging and default on
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("Show extensible event representation of events"),
        default: false,
    },
    "doNotDisturb": {
        supportedLevels: [SettingLevel.DEVICE],
        default: false,
        controller: new IncompatibleController("feature_dnd", false, false),
    },
    "mjolnirRooms": {
        supportedLevels: [SettingLevel.ACCOUNT],
        default: [],
    },
    "mjolnirPersonalRoom": {
        supportedLevels: [SettingLevel.ACCOUNT],
        default: null,
    },
    "feature_bridge_state": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("Show info about bridges in room settings"),
        default: false,
    },
    "feature_breadcrumbs_v2": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("Use new room breadcrumbs"),
        default: false,
    },
    "feature_spotlight": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("New search experience"),
        default: false,
        betaInfo: {
            title: _td("The new search"),
            caption: () => <>
                <p>{ _t("A new, quick way to search spaces and rooms you're in.") }</p>
                <p>{ _t("This feature is a work in progress, we'd love to hear your feedback.") }</p>
            </>,
            disclaimer: () => <>
                { SdkConfig.get().bug_report_endpoint_url && <>
                    <h4>{ _t("How can I give feedback?") }</h4>
                    <p>{ _t("To feedback, join the beta, start a search and click on feedback.") }</p>
                </> }
                <h4>{ _t("How can I leave the beta?") }</h4>
                <p>{ _t("To leave, just return to this page or click on the beta badge when you search.") }</p>
            </>,
            feedbackLabel: "spotlight-feedback",
            feedbackSubheading: _td("Thank you for trying the beta, " +
                "please go into as much detail as you can so we can improve it."),
            image: require("../../res/img/betas/new_search_experience.gif"),
        },
    },
    "feature_right_panel_default_open": {
        isFeature: true,
        labsGroup: LabGroup.Rooms,
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("Right panel stays open (defaults to room member list)"),
        default: false,
    },
    "feature_jump_to_date": {
        // We purposely leave out `isFeature: true` so it doesn't show in Labs
        // by default. We will conditionally show it depending on whether we can
        // detect MSC3030 support (see LabUserSettingsTab.tsx).
        // labsGroup: LabGroup.Messaging,
        displayName: _td("Jump to date (adds /jumptodate and jump to date headers)"),
        supportedLevels: LEVELS_FEATURE,
        default: false,
    },
    "RoomList.backgroundImage": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: null,
    },
    "feature_hidden_read_receipts": {
        supportedLevels: LEVELS_FEATURE,
        displayName: _td("Don't send read receipts"),
        default: false,
    },
    "baseFontSize": {
        displayName: _td("Font size"),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: 10,
        controller: new FontSizeController(),
    },
    "useCustomFontSize": {
        displayName: _td("Use custom size"),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
    },
    "MessageComposerInput.suggestEmoji": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable Emoji suggestions while typing'),
        default: true,
        invertedSettingName: 'MessageComposerInput.dontSuggestEmoji',
    },
    "MessageComposerInput.showStickersButton": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Show stickers button'),
        default: true,
        controller: new UIFeatureController(UIFeature.Widgets, false),
    },
    // TODO: Wire up appropriately to UI (FTUE notifications)
    "Notifications.alwaysShowBadgeCounts": {
        supportedLevels: LEVELS_ROOM_OR_ACCOUNT,
        default: false,
    },
    "useCompactLayout": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        displayName: _td("Use a more compact 'Modern' layout"),
        default: false,
        controller: new IncompatibleController("layout", false, v => v !== Layout.Group),
    },
    "showRedactions": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td('Show a placeholder for removed messages'),
        default: false,
        invertedSettingName: 'hideRedactions',
    },
    "showJoinLeaves": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td('Show join/leave messages (invites/removes/bans unaffected)'),
        default: true,
        invertedSettingName: 'hideJoinLeaves',
    },
    "showAvatarChanges": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td('Show avatar changes'),
        default: true,
        invertedSettingName: 'hideAvatarChanges',
    },
    "showDisplaynameChanges": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td('Show display name changes'),
        default: true,
        invertedSettingName: 'hideDisplaynameChanges',
    },
    "showReadReceipts": {
        supportedLevels: LEVELS_ROOM_SETTINGS,
        displayName: _td('Show read receipts sent by other users'),
        default: true,
        invertedSettingName: 'hideReadReceipts',
    },
    "showTwelveHourTimestamps": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Show timestamps in 12 hour format (e.g. 2:30pm)'),
        default: false,
    },
    "alwaysShowTimestamps": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Always show message timestamps'),
        default: true,
    },
    "autoplayGifs": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Autoplay GIFs'),
        default: true,
    },
    "autoplayVideo": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Autoplay videos'),
        default: false,
    },
    "enableSyntaxHighlightLanguageDetection": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable automatic language detection for syntax highlighting'),
        default: false,
    },
    "expandCodeByDefault": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Expand code blocks by default'),
        default: false,
    },
    "showCodeLineNumbers": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Show line numbers in code blocks'),
        default: true,
    },
    "scrollToBottomOnMessageSent": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Jump to the bottom of the timeline when you send a message'),
        default: true,
    },
    "Pill.shouldShowPillAvatar": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Show avatars in user and room mentions'),
        default: true,
        invertedSettingName: 'Pill.shouldHidePillAvatar',
    },
    "TextualBody.enableBigEmoji": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable big emoji in chat'),
        default: true,
        invertedSettingName: 'TextualBody.disableBigEmoji',
    },
    "MessageComposerInput.isRichTextEnabled": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
    },
    "MessageComposer.showFormatting": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
    },
    "sendTypingNotifications": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Send typing notifications"),
        default: true,
        invertedSettingName: 'dontSendTypingNotifications',
    },
    "showTypingNotifications": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Show typing notifications"),
        default: true,
    },
    "ctrlFForSearch": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: isMac ? _td("Use Command + F to search timeline") : _td("Use Ctrl + F to search timeline"),
        default: true,
    },
    "MessageComposerInput.ctrlEnterToSend": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: isMac ? _td("Use Command + Enter to send a message") : _td("Use Ctrl + Enter to send a message"),
        default: false,
    },
    "MessageComposerInput.surroundWith": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Surround selected text when typing special characters"),
        default: false,
    },
    "MessageComposerInput.autoReplaceEmoji": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Automatically replace plain text Emoji'),
        default: false,
    },
    "VideoView.flipVideoHorizontally": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Mirror local video feed'),
        default: false,
    },
    "TagPanel.enableTagPanel": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable Community Filter Panel'),
        default: true,
        invertedSettingName: 'TagPanel.disableTagPanel',
        // We force the value to true because the invertedSettingName causes it to flip
        controller: new UIFeatureController(UIFeature.Communities, true),
    },
    "light_theme": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: "light",
        controller: new ThemeController("light"),
    },
    "dark_theme": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: "dark",
        controller: new ThemeController("dark"),
    },
    "theme_in_use": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: Theme.System,
    },
    "custom_themes": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: [],
    },
    "userNameColorModeDM": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: UserNameColorMode.Uniform,
    },
    "userNameColorModeGroup": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: UserNameColorMode.Uniform,
    },
    "userNameColorModePublic": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: UserNameColorMode.Uniform,
    },
    "useSystemFont": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: false,
        displayName: _td("Use a system font"),
        controller: new UseSystemFontController(),
    },
    "systemFont": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: "",
        displayName: _td("System font name"),
        controller: new SystemFontController(),
    },
    "webRtcAllowPeerToPeer": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        displayName: _td(
            "Allow Peer-to-Peer for 1:1 calls " +
            "(if you enable this, the other party might be able to see your IP address)",
        ),
        default: true,
        invertedSettingName: 'webRtcForceTURN',
    },
    "webrtc_audiooutput": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: null,
    },
    "webrtc_audioinput": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: null,
    },
    "webrtc_videoinput": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: null,
    },
    "language": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: "en",
    },
    "breadcrumb_rooms": {
        // not really a setting
        supportedLevels: [SettingLevel.ACCOUNT],
        default: [],
    },
    "recent_emoji": {
        // not really a setting
        supportedLevels: [SettingLevel.ACCOUNT],
        default: [],
    },
    "SpotlightSearch.recentSearches": {
        // not really a setting
        supportedLevels: [SettingLevel.ACCOUNT],
        default: [], // list of room IDs, most recent first
    },
    "room_directory_servers": {
        supportedLevels: [SettingLevel.ACCOUNT],
        default: [],
    },
    "integrationProvisioning": {
        supportedLevels: [SettingLevel.ACCOUNT],
        default: true,
    },
    "allowedWidgets": {
        supportedLevels: [SettingLevel.ROOM_ACCOUNT, SettingLevel.ROOM_DEVICE],
        supportedLevelsAreOrdered: true,
        default: {}, // none allowed
    },
    "analyticsOptIn": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        displayName: _td('Send analytics data'),
        default: false,
    },
    "showCookieBar": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: true,
    },
    "pseudonymousAnalyticsOptIn": {
        supportedLevels: [SettingLevel.ACCOUNT],
        displayName: _td('Send analytics data'),
        default: null,
    },
    "autocompleteDelay": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: 200,
    },
    "readMarkerInViewThresholdMs": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: 3000,
    },
    "readMarkerOutOfViewThresholdMs": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: 30000,
    },
    "blacklistUnverifiedDevices": {
        // We specifically want to have room-device > device so that users may set a device default
        // with a per-room override.
        supportedLevels: [SettingLevel.ROOM_DEVICE, SettingLevel.DEVICE],
        supportedLevelsAreOrdered: true,
        displayName: {
            "default": _td('Never send encrypted messages to unverified sessions from this session'),
            "room-device": _td('Never send encrypted messages to unverified sessions in this room from this session'),
        },
        default: false,
        controller: new UIFeatureController(UIFeature.AdvancedEncryption),
    },
    "urlPreviewsEnabled": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: {
            "default": _td('Enable inline URL previews by default'),
            "room-account": _td("Enable URL previews for this room (only affects you)"),
            "room": _td("Enable URL previews by default for participants in this room"),
        },
        default: true,
        controller: new UIFeatureController(UIFeature.URLPreviews),
    },
    "urlPreviewsEnabled_e2ee": {
        supportedLevels: [SettingLevel.ROOM_DEVICE, SettingLevel.ROOM_ACCOUNT],
        displayName: {
            "room-account": _td("Enable URL previews for this room (only affects you)"),
        },
        default: false,
        controller: new UIFeatureController(UIFeature.URLPreviews),
    },
    "youtubeEmbedPlayer": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable YouTube embed player'),
        default: true,
        controller: new UIFeatureController(UIFeature.YoutubeEmbedPlayer),
    },
    "notificationsEnabled": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: false,
        controller: new NotificationsEnabledController(),
    },
    "notificationSound": {
        supportedLevels: LEVELS_ROOM_OR_ACCOUNT,
        default: false,
    },
    "notificationBodyEnabled": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: true,
        controller: new NotificationBodyEnabledController(),
    },
    "audioNotificationsEnabled": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: true,
    },
    "enableWidgetScreenshots": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Enable widget screenshots on supported widgets'),
        default: false,
    },
    "promptBeforeInviteUnknownUsers": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Prompt before sending invites to potentially invalid matrix IDs'),
        default: true,
    },
    "showDeveloperTools": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td('Show developer tools'),
        default: false,
    },
    "widgetOpenIDPermissions": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: {
            allow: [],
            deny: [],
        },
    },
    // TODO: Remove setting: https://github.com/vector-im/element-web/issues/14373
    "RoomList.orderAlphabetically": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Order rooms by name"),
        default: false,
    },
    // TODO: Remove setting: https://github.com/vector-im/element-web/issues/14373
    "RoomList.orderByImportance": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Show rooms with unread notifications first"),
        default: true,
    },
    "unifiedRoomList": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Show people and rooms in a combined list"),
        default: true,
        controller: new ReloadOnChangeController(),
    },
    "roomListStyle": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: RoomListStyle.Roomy,
        controller: new ReloadOnChangeController(),
    },
    "breadcrumbs": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Show shortcuts to recently viewed rooms above the room list"),
        default: true,
        controller: new IncompatibleController("feature_breadcrumbs_v2", true),
    },
    "showHiddenEventsInTimeline": {
        displayName: _td("Show hidden events in timeline"),
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: false,
    },
    "lowBandwidth": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        displayName: _td('Low bandwidth mode (requires compatible homeserver)'),
        default: false,
        controller: new ReloadOnChangeController(),
    },
    "fallbackICEServerAllowed": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        displayName: _td(
            "Allow fallback call assist server turn.matrix.org when your homeserver " +
            "does not offer one (your IP address would be shared during a call)",
        ),
        // This is a tri-state value, where `null` means "prompt the user".
        default: null,
    },
    "showImages": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        displayName: _td("Show previews/thumbnails for images"),
        default: true,
    },
    "RightPanel.phasesGlobal": {
        supportedLevels: [SettingLevel.DEVICE],
        default: null,
    },
    "RightPanel.phases": {
        supportedLevels: [SettingLevel.ROOM_DEVICE],
        default: null,
    },
    "enableEventIndexing": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        displayName: _td("Enable message search in encrypted rooms"),
        default: true,
    },
    "crawlerSleepTime": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        displayName: _td("How fast should messages be downloaded."),
        default: 3000,
    },
    "showCallButtonsInComposer": {
        // Dev note: This is no longer "in composer" but is instead "in room header".
        // TODO: Rename with settings v3
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: true,
        controller: new UIFeatureController(UIFeature.Voip),
    },
    "e2ee.manuallyVerifyAllSessions": {
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        displayName: _td("Manually verify all remote sessions"),
        default: false,
        controller: new OrderedMultiController([
            // Apply the feature controller first to ensure that the setting doesn't
            // show up and can't be toggled. PushToMatrixClientController doesn't
            // do any overrides anyways.
            new UIFeatureController(UIFeature.AdvancedEncryption),
            new PushToMatrixClientController(
                MatrixClient.prototype.setCryptoTrustCrossSignedDevices, true,
            ),
        ]),
    },
    "ircDisplayNameWidth": {
        // We specifically want to have room-device > device so that users may set a device default
        // with a per-room override.
        supportedLevels: [SettingLevel.ROOM_DEVICE, SettingLevel.DEVICE],
        supportedLevelsAreOrdered: true,
        displayName: _td("IRC display name width"),
        default: 80,
    },
    "layout": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: Layout.Bubble,
    },
    "singleSideBubbles": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td("Show message bubbles on one side only"),
        default: false,
    },
    "adaptiveSideBubbles": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td("Show message bubbles depending on the width either on both sides or only on one side"),
        default: true,
    },
    "Images.size": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: ImageSize.Normal,
    },
    "showChatEffects": {
        supportedLevels: LEVELS_ROOM_SETTINGS_WITH_ROOM,
        displayName: _td("Show chat effects (animations when receiving e.g. confetti)"),
        default: true,
        controller: new ReducedMotionController(),
    },
    "Performance.addSendMessageTimingMetadata": {
        supportedLevels: [SettingLevel.CONFIG],
        default: false,
    },
    "Widgets.pinned": { // deprecated
        supportedLevels: LEVELS_ROOM_OR_ACCOUNT,
        default: {},
    },
    "Widgets.layout": {
        supportedLevels: LEVELS_ROOM_OR_ACCOUNT,
        default: {},
    },
    "Widgets.leftPanel": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: null,
    },
    "Spaces.allRoomsInHome": {
        displayName: _td("Show all rooms in Home"),
        description: _td("All rooms you're in will appear in Home."),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: true,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", null),
    },
    "Spaces.showSpaceDMBadges": {
        displayName: _td("Show notification badges for People in Spaces"),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: true,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", null),
    },
    "Spaces.returnToPreviouslyOpenedRoom": {
        displayName: _td("Return to the room previously opened in a space"),
        description: _td("If disabled, the space overview will be shown when switching to another space."),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", null),
    },
    "Spaces.enabledMetaSpaces": {
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: {
            [MetaSpace.Home]: true,
        },
    },
    "Spaces.showPeopleInSpace": {
        supportedLevels: [SettingLevel.ROOM_ACCOUNT],
        default: false,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", null),
    },
    "showCommunitiesInsteadOfSpaces": {
        displayName: _td("Display Communities instead of Spaces"),
        description: _td("Temporarily show communities instead of Spaces for this session. " +
            "Support for this will be removed in the near future. This will reload Element."),
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS_WITH_CONFIG,
        default: false,
        controller: new ReloadOnChangeController(),
    },
    "developerMode": {
        displayName: _td("Developer mode"),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
    },
    "automaticErrorReporting": {
        displayName: _td("Automatically send debug logs on any error"),
        supportedLevels: LEVELS_ACCOUNT_SETTINGS,
        default: false,
        controller: new ReloadOnChangeController(),
    },
    "automaticDecryptionErrorReporting": {
        displayName: _td("Automatically send debug logs on decryption errors"),
        supportedLevels: LEVELS_DEVICE_ONLY_SETTINGS,
        default: false,
        controller: new ReloadOnChangeController(),
    },
    [UIFeature.RoomHistorySettings]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.AdvancedEncryption]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.URLPreviews]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Widgets]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Voip]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Feedback]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Registration]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.PasswordReset]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Deactivate]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.ShareQRCode]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.ShareSocial]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.IdentityServer]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
        // Identity server (discovery) settings make no sense if 3PIDs in general are hidden
        controller: new UIFeatureController(UIFeature.ThirdPartyID),
    },
    [UIFeature.ThirdPartyID]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.Flair]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
        // Disable Flair when Communities are disabled
        controller: new UIFeatureController(UIFeature.Communities),
    },
    [UIFeature.Communities]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
        controller: new IncompatibleController("showCommunitiesInsteadOfSpaces", false, false),
    },
    [UIFeature.AdvancedSettings]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.TimelineEnableRelativeDates]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
    [UIFeature.YoutubeEmbedPlayer]: {
        supportedLevels: LEVELS_UI_FEATURE,
        default: true,
    },
};
