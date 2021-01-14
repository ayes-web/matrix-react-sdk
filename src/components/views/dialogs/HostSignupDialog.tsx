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

import * as React from "react";
import Modal from "../../../Modal";
import PersistedElement from "../elements/PersistedElement";
import QuestionDialog from './QuestionDialog';
import SdkConfig from "../../../SdkConfig";
import {_t} from "../../../languageHandler";
import {MatrixClientPeg} from "../../../MatrixClientPeg";
import {HostSignupStore} from "../../../stores/HostSignupStore";
import {OwnProfileStore} from "../../../stores/OwnProfileStore";
import {IPostmessage, IPostmessageResponseData, PostmessageAction} from "./HostSignupDialogTypes";

interface IProps {}

interface IState {
    completed: boolean;
    error: string;
    loadIframe: boolean;
    minimized: boolean;
}

export default class HostSignupDialog extends React.PureComponent<IProps, IState> {
    private iframeRef: React.RefObject<HTMLIFrameElement> = React.createRef();
    private readonly hostSignupSetupUrl: string;

    constructor(props: IProps) {
        super(props);

        this.state = {
            completed: false,
            error: null,
            loadIframe: false,
            minimized: false,
        };

        this.hostSignupSetupUrl = SdkConfig.get().host_signup.url;
    }

    private messageHandler = async (message: IPostmessage) => {
        if (!this.hostSignupSetupUrl.startsWith(message.origin)) {
            return;
        }
        switch (message.data.action) {
            case PostmessageAction.HostSignupAccountDetailsRequest:
                await this.sendAccountDetails();
                break;
            case PostmessageAction.Maximize:
                this.maximizeDialog();
                break;
            case PostmessageAction.Minimize:
                this.minimizeDialog();
                break;
            case PostmessageAction.SetupComplete:
                // Set as completed but let the user close the modal themselves
                // so they have time to finish reading any information
                this.setState({
                    completed: true,
                });
                break;
            case PostmessageAction.CloseDialog:
                return this.onFinished(true);
        }
    }

    private maximizeDialog = () => {
        this.setState({
            minimized: false,
        });
    }

    private minimizeDialog = () => {
        this.setState({
            minimized: true,
        });
    }

    private closeDialog = async () => {
        window.removeEventListener("message", this.messageHandler);
        // Ensure we destroy the host signup persisted element
        PersistedElement.destroyElement("host_signup");
        // Finally clear the flag in
        return HostSignupStore.instance.setHostSignupActive(false);
    }

    private onFinished = async (result: boolean) => {
        if (result || this.state.completed) {
            // We're done, close
            return this.closeDialog();
        } else {
            Modal.createDialog(
                QuestionDialog,
                {
                    title: _t("Confirm Abort Of Host Creation"),
                    description: _t(
                        "Are you sure you wish to abort creation of the host? The process cannot be continued.",
                    ),
                    button: _t("Abort"),
                    onFinished: result => {
                        if (result) {
                            return this.closeDialog();
                        }
                    },
                },
            );
        }
    }

    private sendMessage = (message: IPostmessageResponseData) => {
        this.iframeRef.current.contentWindow.postMessage(message, this.hostSignupSetupUrl);
    }

    private async sendAccountDetails() {
        const openIdToken = await MatrixClientPeg.get().getOpenIdToken();
        if (!openIdToken || !openIdToken.access_token) {
            this.setState({
                completed: true,
                error: _t("Failed to connect to your homeserver. Please close this dialog and try again."),
            });
            return;
        }
        this.sendMessage({
            action: PostmessageAction.HostSignupAccountDetails,
            account: {
                accessToken: await MatrixClientPeg.get().getAccessToken(),
                name: OwnProfileStore.instance.displayName,
                openIdToken: openIdToken.access_token,
                serverName: await MatrixClientPeg.get().getDomain(),
                userLocalpart: await MatrixClientPeg.get().getUserIdLocalpart(),
            },
        });
    }

    private loadIframe = () => {
        window.addEventListener("message", this.messageHandler);
        this.setState({
            loadIframe: true,
        });
    }

    public componentWillUnmount() {
        if (HostSignupStore.instance.isHostSignupActive) {
            // Run the close dialog actions if we're still active, otherwise good to go
            return this.closeDialog();
        }
    }

    public render(): React.ReactNode {
        return (
            <div className="mx_HostSignup_persisted">
                <PersistedElement key="host_signup" persistKey="host_signup">
                    <div className={this.state.minimized ? "" : "mx_Dialog_wrapper"}>
                        <div className={
                            this.state.minimized ? "mx_HostSignupDialog_minimized" : "mx_HostSignupDialog mx_Dialog"
                        }>
                            {this.state.loadIframe &&
                                <iframe
                                    src={this.hostSignupSetupUrl}
                                    ref={this.iframeRef}
                                    sandbox="allow-forms allow-scripts allow-same-origin"
                                />
                            }
                            {!this.state.loadIframe &&
                                <div className="mx_HostSignupDialog_info">
                                    {this.state.minimized &&
                                        <button onClick={this.maximizeDialog}>Maximize</button>
                                    }
                                    <img
                                        alt="image of planet"
                                        src={require("../../../../res/img/host_signup.png")}
                                    />
                                    <div className="mx_HostSignupDialog_content">
                                        <h1>Unlock the power of Element</h1>
                                        <p>
                                            Congratulations! You taken your first steps into unlocking the full&nbsp;
                                            power of the Element app. In a few minutes, you'll be able to&nbsp;
                                            see how powerful our&nbsp;
                                            Matrix services are and take control of your conversation data.
                                        </p>
                                    </div>
                                    <div>
                                        <button onClick={this.closeDialog}>Maybe later</button>
                                        <button onClick={this.loadIframe} className="mx_Dialog_primary">
                                            Lets get started
                                        </button>
                                        <button onClick={this.minimizeDialog}>Minimize</button>
                                    </div>
                                </div>
                            }
                            {this.state.error &&
                                <div>
                                    {this.state.error}
                                </div>
                            }
                        </div>
                        {!this.state.minimized &&
                            <div className="mx_Dialog_background" />
                        }
                    </div>
                </PersistedElement>
            </div>
        );
    }
}
