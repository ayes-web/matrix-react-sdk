/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import React from "react";
import { logger } from "matrix-js-sdk/src/logger";

import { replaceableComponent } from "../../../utils/replaceableComponent";
import { Playback } from "../../../audio/Playback";
import InlineSpinner from '../elements/InlineSpinner';
import { _t } from "../../../languageHandler";
import AudioPlayer from "../audio_messages/AudioPlayer";
import { IMediaEventContent } from "../../../customisations/models/IMediaEventContent";
import MFileBody from "./MFileBody";
import { IBodyProps } from "./IBodyProps";
import { PlaybackManager } from "../../../audio/PlaybackManager";
import { isVoiceMessage } from "../../../utils/EventUtils";
import { PlaybackQueue } from "../../../audio/PlaybackQueue";

interface IState {
    error?: Error;
    playback?: Playback;
}

@replaceableComponent("views.messages.MAudioBody")
export default class MAudioBody extends React.PureComponent<IBodyProps, IState> {
    constructor(props: IBodyProps) {
        super(props);

        this.state = {};
    }

    public async componentDidMount() {
        let buffer: ArrayBuffer;

        try {
            try {
                const blob = await this.props.mediaEventHelper.sourceBlob.value;
                buffer = await blob.arrayBuffer();
            } catch (e) {
                this.setState({ error: e });
                logger.warn("Unable to decrypt audio message", e);
                return; // stop processing the audio file
            }
        } catch (e) {
            this.setState({ error: e });
            logger.warn("Unable to decrypt/download audio message", e);
            return; // stop processing the audio file
        }

        // We should have a buffer to work with now: let's set it up

        // Note: we don't actually need a waveform to render an audio event, but voice messages do.
        const content = this.props.mxEvent.getContent<IMediaEventContent>();
        const waveform = content?.["org.matrix.msc1767.audio"]?.waveform?.map(p => p / 1024);

        // We should have a buffer to work with now: let's set it up
        const playback = PlaybackManager.instance.createPlaybackInstance(buffer, waveform);
        playback.clockInfo.populatePlaceholdersFrom(this.props.mxEvent);
        this.setState({ playback });

        if (isVoiceMessage(this.props.mxEvent)) {
            PlaybackQueue.forRoom(this.props.mxEvent.getRoomId()).unsortedEnqueue(this.props.mxEvent, playback);
        }

        // Note: the components later on will handle preparing the Playback class for us.
    }

    public componentWillUnmount() {
        this.state.playback?.destroy();
    }

    public render() {
        if (this.state.error) {
            return (
                <span className="mx_MAudioBody">
                    <img src={require("../../../../res/img/warning.svg")} width="16" height="16" />
                    { _t("Error processing audio message") }
                </span>
            );
        }

        if (this.props.forExport) {
            const content = this.props.mxEvent.getContent();
            // During export, the content url will point to the MSC, which will later point to a local url
            const contentUrl = content.file?.url || content.url;
            return (
                <span className="mx_MAudioBody">
                    <audio src={contentUrl} controls />
                </span>
            );
        }

        if (!this.state.playback) {
            return (
                <span className="mx_MAudioBody">
                    <InlineSpinner />
                </span>
            );
        }

        // At this point we should have a playable state
        return (
            <span className="mx_MAudioBody">
                <AudioPlayer playback={this.state.playback} mediaName={this.props.mxEvent.getContent().body} />
                { this.props.tileShape && <MFileBody {...this.props} showGenericPlaceholder={false} /> }
                { this.props.scBubbleGroupTimestamp }
            </span>
        );
    }
}
