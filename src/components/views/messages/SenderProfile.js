/*
 Copyright 2015, 2016 OpenMarket Ltd

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

'use strict';

import React from 'react';
import sdk from '../../../index';
import Flair from '../elements/Flair.js';
import { _t } from '../../../languageHandler';

export default function SenderProfile(props) {
    const EmojiText = sdk.getComponent('elements.EmojiText');
    const {mxEvent} = props;
    const name = mxEvent.sender ? mxEvent.sender.name : mxEvent.getSender();
    const {msgtype} = mxEvent.getContent();

    if (msgtype === 'm.emote') {
        return <span />; // emote message must include the name so don't duplicate it
    }

    const nameElem = <EmojiText key='name'>{ name || '' }</EmojiText>;

    // Name + flair
    const nameFlair = <span>
        <span className="mx_SenderProfile_name">
            { nameElem }
        </span>
        { props.enableFlair ?
            <Flair key='flair'
                userId={mxEvent.getSender()}
                roomId={mxEvent.getRoomId()}
                showRelated={true} />
            : null
        }
    </span>;

    const content = props.text ?
        <span className="mx_SenderProfile_aux">
            { _t(props.text, { senderName: () => nameElem }) }
        </span> : nameFlair;

    return (
        <div className="mx_SenderProfile" dir="auto" onClick={props.onClick}>
            { content }
        </div>
    );
}

SenderProfile.propTypes = {
    mxEvent: React.PropTypes.object.isRequired, // event whose sender we're showing
    text: React.PropTypes.string, // Text to show. Defaults to sender name
    onClick: React.PropTypes.func,
};
