/*
Copyright 2020-2021 Tulir Asokan <tulir@maunium.net>

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
import classNames from 'classnames';
import { MatrixEvent } from "matrix-js-sdk/src/models/event";
import { EventType, MsgType } from 'matrix-js-sdk/src/@types/event';
import { logger } from "matrix-js-sdk/src/logger";
import { Relations } from 'matrix-js-sdk/src/models/relations';

import { _t } from '../../../languageHandler';
import dis from '../../../dispatcher/dispatcher';
import { Action } from '../../../dispatcher/actions';
import { RoomPermalinkCreator } from '../../../utils/permalinks/Permalinks';
import SenderProfile from "../messages/SenderProfile";
import MImageReplyBody from "../messages/MImageReplyBody";
import * as sdk from '../../../index';
import { replaceableComponent } from '../../../utils/replaceableComponent';
import { getEventDisplayInfo, isVoiceMessage } from '../../../utils/EventUtils';
import MFileBody from "../messages/MFileBody";
import MVoiceMessageBody from "../messages/MVoiceMessageBody";
import { UserNameColorMode } from '../../../settings/enums/UserNameColorMode';

interface IProps {
    mxEvent: MatrixEvent;
    permalinkCreator?: RoomPermalinkCreator;
    userNameColorMode?: UserNameColorMode;
    highlights?: string[];
    highlightLink?: string;
    onHeightChanged?(): void;
    toggleExpandedQuote?: () => void;
    getRelationsForEvent?: (
        (eventId: string, relationType: string, eventType: string) => Relations
    );
}

@replaceableComponent("views.rooms.ReplyTile")
export default class ReplyTile extends React.PureComponent<IProps> {
    private anchorElement = createRef<HTMLAnchorElement>();

    static defaultProps = {
        onHeightChanged: () => {},
    };

    componentDidMount() {
        this.props.mxEvent.on("Event.decrypted", this.onDecrypted);
        this.props.mxEvent.on("Event.beforeRedaction", this.onEventRequiresUpdate);
        this.props.mxEvent.on("Event.replaced", this.onEventRequiresUpdate);
    }

    componentWillUnmount() {
        this.props.mxEvent.removeListener("Event.decrypted", this.onDecrypted);
        this.props.mxEvent.removeListener("Event.beforeRedaction", this.onEventRequiresUpdate);
        this.props.mxEvent.removeListener("Event.replaced", this.onEventRequiresUpdate);
    }

    private onDecrypted = (): void => {
        this.forceUpdate();
        if (this.props.onHeightChanged) {
            this.props.onHeightChanged();
        }
    };

    private onEventRequiresUpdate = (): void => {
        // Force update when necessary - redactions and edits
        this.forceUpdate();
    };

    private onClick = (e: React.MouseEvent): void => {
        const clickTarget = e.target as HTMLElement;
        // Following a link within a reply should not dispatch the `view_room` action
        // so that the browser can direct the user to the correct location
        // The exception being the link wrapping the reply
        if (
            clickTarget.tagName.toLowerCase() !== "a" ||
            clickTarget.closest("a") === null ||
            clickTarget === this.anchorElement.current
        ) {
            // This allows the permalink to be opened in a new tab/window or copied as
            // matrix.to, but also for it to enable routing within Riot when clicked.
            e.preventDefault();
            // Expand thread on shift key
            if (this.props.toggleExpandedQuote && e.shiftKey) {
                this.props.toggleExpandedQuote();
            } else {
                dis.dispatch({
                    action: Action.ViewRoom,
                    event_id: this.props.mxEvent.getId(),
                    highlighted: true,
                    room_id: this.props.mxEvent.getRoomId(),
                });
            }
        }
    };

    render() {
        const mxEvent = this.props.mxEvent;
        const msgType = mxEvent.getContent().msgtype;
        const evType = mxEvent.getType() as EventType;

        const { tileHandler, isInfoMessage, isSeeingThroughMessageHiddenForModeration } = getEventDisplayInfo(mxEvent);
        // This shouldn't happen: the caller should check we support this type
        // before trying to instantiate us
        if (!tileHandler) {
            const { mxEvent } = this.props;
            logger.warn(`Event type not supported: type:${mxEvent.getType()} isState:${mxEvent.isState()}`);
            return <div className="mx_ReplyTile mx_ReplyTile_info mx_MNoticeBody">
                { _t('This event could not be displayed') }
            </div>;
        }

        const EventTileType = sdk.getComponent(tileHandler);

        const classes = classNames("mx_ReplyTile", {
            mx_ReplyTile_info: isInfoMessage && !mxEvent.isRedacted(),
            mx_ReplyTile_audio: msgType === MsgType.Audio,
            mx_ReplyTile_video: msgType === MsgType.Video,
        });

        let permalink = "#";
        if (this.props.permalinkCreator) {
            permalink = this.props.permalinkCreator.forEvent(mxEvent.getId());
        }

        let sender;
        const needsSenderProfile = (
            !isInfoMessage &&
            msgType !== MsgType.Image &&
            tileHandler !== EventType.RoomCreate &&
            evType !== EventType.Sticker
        );

        if (needsSenderProfile) {
            sender = <SenderProfile
                mxEvent={mxEvent}
                enableFlair={false}
                userNameColorMode={this.props.userNameColorMode}
            />;
        }

        const msgtypeOverrides = {
            [MsgType.Image]: MImageReplyBody,
            // Override audio and video body with file body. We also hide the download/decrypt button using CSS
            [MsgType.Audio]: isVoiceMessage(mxEvent) ? MVoiceMessageBody : MFileBody,
            [MsgType.Video]: MFileBody,
        };
        const evOverrides = {
            // Use MImageReplyBody so that the sticker isn't taking up a lot of space
            [EventType.Sticker]: MImageReplyBody,
        };

        return (
            <div className={classes}>
                <a href={permalink} onClick={this.onClick} ref={this.anchorElement}>
                    { sender }
                    <EventTileType
                        ref="tile"
                        mxEvent={mxEvent}
                        highlights={this.props.highlights}
                        highlightLink={this.props.highlightLink}
                        onHeightChanged={this.props.onHeightChanged}
                        userNameColorMode={this.props.userNameColorMode}
                        youtubeEmbedPlayer={false}
                        showUrlPreview={false}
                        overrideBodyTypes={msgtypeOverrides}
                        overrideEventTypes={evOverrides}
                        replacingEventId={mxEvent.replacingEventId()}
                        maxImageHeight={96}
                        getRelationsForEvent={this.props.getRelationsForEvent}
                        isSeeingThroughMessageHiddenForModeration={isSeeingThroughMessageHiddenForModeration}
                    />
                </a>
            </div>
        );
    }
}
