/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import React from 'react';
import classnames from 'classnames';
import { MatrixEvent } from 'matrix-js-sdk/src/models/event';
import { RoomMember } from 'matrix-js-sdk/src/models/room-member';

import * as Avatar from '../../../Avatar';
import EventTile from '../rooms/EventTile';
import SettingsStore from "../../../settings/SettingsStore";
import { Layout } from "../../../settings/enums/Layout";
import { UIFeature } from "../../../settings/UIFeature";
import { replaceableComponent } from "../../../utils/replaceableComponent";
import Spinner from './Spinner';

interface IProps {
    /**
     * The text to be displayed in the message preview
     */
    message: string;

    /**
     * Which layout to use
     */
    layout: Layout;

    /**
     * classnames to apply to the wrapper of the preview
     */
    className: string;

    /**
     * The ID of the displayed user
     */
    userId?: string;

    /**
     * The display name of the displayed user
     */
    displayName?: string;

    /**
     * The mxc:// avatar URL of the displayed user
     */
    avatarUrl?: string;
}

interface IState {
    message: string;
}

const AVATAR_SIZE = 32;

@replaceableComponent("views.elements.EventTilePreview")
export default class EventTilePreview extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            message: props.message,
        };
    }

    private fakeEvent({ message }: IState) {
        // Fake it till we make it
        /* eslint-disable quote-props */
        const rawEvent = {
            type: "m.room.message",
            sender: this.props.userId,
            content: {
                "m.new_content": {
                    msgtype: "m.text",
                    body: message,
                    displayname: this.props.displayName,
                    avatar_url: this.props.avatarUrl,
                },
                msgtype: "m.text",
                body: message,
                displayname: this.props.displayName,
                avatar_url: this.props.avatarUrl,
            },
            unsigned: {
                age: 97,
            },
            event_id: "$9999999999999999999999999999999999999999999",
            room_id: "!999999999999999999:example.org",
        };
        const event = new MatrixEvent(rawEvent);
        /* eslint-enable quote-props */

        // Fake it more
        event.sender = {
            name: this.props.displayName || this.props.userId,
            rawDisplayName: this.props.displayName,
            userId: this.props.userId,
            getAvatarUrl: (..._) => {
                return Avatar.avatarUrlForUser(
                    { avatarUrl: this.props.avatarUrl },
                    AVATAR_SIZE, AVATAR_SIZE, "crop",
                );
            },
            getMxcAvatarUrl: () => this.props.avatarUrl,
        } as RoomMember;

        return event;
    }

    public render() {
        const className = classnames(this.props.className, {
            "mx_IRCLayout": this.props.layout === Layout.IRC,
            "mx_GroupLayout": this.props.layout === Layout.Group,
            "sc_BubbleLayout": this.props.layout === Layout.Bubble,
            "mx_EventTilePreview_loader": !this.props.userId,
        });

        if (!this.props.userId) return <div className={className}><Spinner /></div>;

        const event = this.fakeEvent(this.state);

        return <div className={className}>
            <EventTile
                mxEvent={event}
                layout={this.props.layout}
                enableFlair={SettingsStore.getValue(UIFeature.Flair)}
                as="div"
            />
        </div>;
    }
}
