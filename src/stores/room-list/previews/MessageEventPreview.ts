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

import { MatrixEvent } from "matrix-js-sdk/src/models/event";

import { IPreview } from "./IPreview";
import { TagID } from "../models";
import { _t, sanitizeForTranslation } from "../../../languageHandler";
import { getSenderName, isSelf, shouldPrefixMessagesIn } from "./utils";
import ReplyChain from "../../../components/views/elements/ReplyChain";
import { getHtmlText } from "../../../HtmlUtils";

export class MessageEventPreview implements IPreview {
    public getTextFor(event: MatrixEvent, tagId?: TagID, isThread?: boolean): string {
        let eventContent = event.getContent();

        if (event.isRelation("m.replace")) {
            // It's an edit, generate the preview on the new text
            eventContent = event.getContent()['m.new_content'];
        }

        if (!eventContent || !eventContent['body']) return null; // invalid for our purposes

        let body = (eventContent['body'] || '').trim();
        const msgtype = eventContent['msgtype'];
        if (!body || !msgtype) return null; // invalid event, no preview

        const hasHtml = eventContent.format === "org.matrix.custom.html" && eventContent.formatted_body;
        if (hasHtml) {
            body = eventContent.formatted_body;
        }

        // XXX: Newer relations have a getRelation() function which is not compatible with replies.
        const mRelatesTo = event.getWireContent()['m.relates_to'];
        if (mRelatesTo && mRelatesTo['m.in_reply_to']) {
            // If this is a reply, get the real reply and use that
            if (hasHtml) {
                body = (ReplyChain.stripHTMLReply(body) || '').trim();
            } else {
                body = (ReplyChain.stripPlainReply(body) || '').trim();
            }
            if (!body) return null; // invalid event, no preview
        }

        if (hasHtml) {
            const sanitised = getHtmlText(body.replace(/<br\/?>/gi, "\n")); // replace line breaks before removing them
            // run it through DOMParser to fixup encoded html entities
            body = new DOMParser().parseFromString(sanitised, "text/html").documentElement.textContent;
        }

        body = sanitizeForTranslation(body);

        if (msgtype === 'm.emote') {
            return _t("* %(senderName)s %(emote)s", { senderName: getSenderName(event), emote: body });
        }

        if (isThread || isSelf(event) || !shouldPrefixMessagesIn(event.getRoomId(), tagId)) {
            return body;
        } else {
            return _t("%(senderName)s: %(message)s", { senderName: getSenderName(event), message: '\u2068' + body });
        }
    }
}
