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

import * as React from "react";
import { createRef } from "react";
import classNames from "classnames";

import dis from "../../dispatcher/dispatcher";
import { _t } from "../../languageHandler";
import RoomList from "../views/rooms/RoomList";
import CallHandler from "../../CallHandler";
import { HEADER_HEIGHT } from "../views/rooms/RoomSublist";
import { Action } from "../../dispatcher/actions";
import RoomSearch from "./RoomSearch";
import ResizeNotifier from "../../utils/ResizeNotifier";
import AccessibleTooltipButton from "../views/elements/AccessibleTooltipButton";
import LeftPanelWidget from "./LeftPanelWidget";
import { replaceableComponent } from "../../utils/replaceableComponent";
import SpaceStore from "../../stores/spaces/SpaceStore";
import { MetaSpace, SpaceKey, UPDATE_SELECTED_SPACE } from "../../stores/spaces";
import { getKeyBindingsManager } from "../../KeyBindingsManager";
import UIStore from "../../stores/UIStore";
import { findSiblingElement, IState as IRovingTabIndexState } from "../../accessibility/RovingTabIndex";
import RoomListHeader from "../views/rooms/RoomListHeader";
import { Key } from "../../Keyboard";
import RecentlyViewedButton from "../views/rooms/RecentlyViewedButton";
import { BreadcrumbsStore } from "../../stores/BreadcrumbsStore";
import RoomListStore, { LISTS_UPDATE_EVENT } from "../../stores/room-list/RoomListStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import IndicatorScrollbar from "./IndicatorScrollbar";
import RoomBreadcrumbs from "../views/rooms/RoomBreadcrumbs";
import SettingsStore from "../../settings/SettingsStore";
import UserMenu from "./UserMenu";
import { KeyBindingAction } from "../../accessibility/KeyboardShortcuts";

interface IProps {
    isMinimized: boolean;
    resizeNotifier: ResizeNotifier;
}

enum BreadcrumbsMode {
    Disabled,
    Legacy,
    Labs,
}

interface IState {
    showBreadcrumbs: BreadcrumbsMode;
    activeSpace: SpaceKey;
}

@replaceableComponent("structures.LeftPanel")
export default class LeftPanel extends React.Component<IProps, IState> {
    private ref = createRef<HTMLDivElement>();
    private listContainerRef = createRef<HTMLDivElement>();
    private roomSearchRef = createRef<RoomSearch>();
    private roomListRef = createRef<RoomList>();
    private focusedElement = null;
    private isDoingStickyHeaders = false;

    constructor(props: IProps) {
        super(props);

        this.state = {
            activeSpace: SpaceStore.instance.activeSpace,
            showBreadcrumbs: LeftPanel.breadcrumbsMode,
        };

        BreadcrumbsStore.instance.on(UPDATE_EVENT, this.onBreadcrumbsUpdate);
        RoomListStore.instance.on(LISTS_UPDATE_EVENT, this.onBreadcrumbsUpdate);
        SpaceStore.instance.on(UPDATE_SELECTED_SPACE, this.updateActiveSpace);
    }

    private static get breadcrumbsMode(): BreadcrumbsMode {
        if (!BreadcrumbsStore.instance.visible) return BreadcrumbsMode.Disabled;
        return SettingsStore.getValue("feature_breadcrumbs_v2") ? BreadcrumbsMode.Labs : BreadcrumbsMode.Legacy;
    }

    public componentDidMount() {
        UIStore.instance.trackElementDimensions("LeftPanel", this.ref.current);
        UIStore.instance.trackElementDimensions("ListContainer", this.listContainerRef.current);
        UIStore.instance.on("ListContainer", this.refreshStickyHeaders);
        // Using the passive option to not block the main thread
        // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#improving_scrolling_performance_with_passive_listeners
        this.listContainerRef.current?.addEventListener("scroll", this.onScroll, { passive: true });
    }

    public componentWillUnmount() {
        BreadcrumbsStore.instance.off(UPDATE_EVENT, this.onBreadcrumbsUpdate);
        RoomListStore.instance.off(LISTS_UPDATE_EVENT, this.onBreadcrumbsUpdate);
        SpaceStore.instance.off(UPDATE_SELECTED_SPACE, this.updateActiveSpace);
        UIStore.instance.stopTrackingElementDimensions("ListContainer");
        UIStore.instance.removeListener("ListContainer", this.refreshStickyHeaders);
        this.listContainerRef.current?.removeEventListener("scroll", this.onScroll);
    }

    public componentDidUpdate(prevProps: IProps, prevState: IState): void {
        if (prevState.activeSpace !== this.state.activeSpace) {
            this.refreshStickyHeaders();
        }
    }

    private updateActiveSpace = (activeSpace: SpaceKey) => {
        this.setState({ activeSpace });
    };

    private onDialPad = () => {
        dis.fire(Action.OpenDialPad);
    };

    private onExplore = () => {
        dis.fire(Action.ViewRoomDirectory);
    };

    private refreshStickyHeaders = () => {
        if (!this.listContainerRef.current) return; // ignore: no headers to sticky
        this.handleStickyHeaders(this.listContainerRef.current);
    };

    private onBreadcrumbsUpdate = () => {
        const newVal = LeftPanel.breadcrumbsMode;
        if (newVal !== this.state.showBreadcrumbs) {
            this.setState({ showBreadcrumbs: newVal });

            // Update the sticky headers too as the breadcrumbs will be popping in or out.
            if (!this.listContainerRef.current) return; // ignore: no headers to sticky
            this.handleStickyHeaders(this.listContainerRef.current);
        }
    };

    private handleStickyHeaders(list: HTMLDivElement) {
        if (this.isDoingStickyHeaders) return;
        this.isDoingStickyHeaders = true;
        window.requestAnimationFrame(() => {
            this.doStickyHeaders(list);
            this.isDoingStickyHeaders = false;
        });
    }

    private doStickyHeaders(list: HTMLDivElement) {
        const topEdge = list.scrollTop;
        const bottomEdge = list.offsetHeight + list.scrollTop;
        const sublists = list.querySelectorAll<HTMLDivElement>(".mx_RoomSublist:not(.mx_RoomSublist_hidden)");

        // We track which styles we want on a target before making the changes to avoid
        // excessive layout updates.
        const targetStyles = new Map<HTMLDivElement, {
            stickyTop?: boolean;
            stickyBottom?: boolean;
            makeInvisible?: boolean;
        }>();

        let lastTopHeader;
        let firstBottomHeader;
        for (const sublist of sublists) {
            const header = sublist.querySelector<HTMLDivElement>(".mx_RoomSublist_stickable");
            header.style.removeProperty("display"); // always clear display:none first

            // When an element is <=40% off screen, make it take over
            const offScreenFactor = 0.4;
            const isOffTop = (sublist.offsetTop + (offScreenFactor * HEADER_HEIGHT)) <= topEdge;
            const isOffBottom = (sublist.offsetTop + (offScreenFactor * HEADER_HEIGHT)) >= bottomEdge;

            if (isOffTop || sublist === sublists[0]) {
                targetStyles.set(header, { stickyTop: true });
                if (lastTopHeader) {
                    lastTopHeader.style.display = "none";
                    targetStyles.set(lastTopHeader, { makeInvisible: true });
                }
                lastTopHeader = header;
            } else if (isOffBottom && !firstBottomHeader) {
                targetStyles.set(header, { stickyBottom: true });
                firstBottomHeader = header;
            } else {
                targetStyles.set(header, {}); // nothing == clear
            }
        }

        // Run over the style changes and make them reality. We check to see if we're about to
        // cause a no-op update, as adding/removing properties that are/aren't there cause
        // layout updates.
        for (const header of targetStyles.keys()) {
            const style = targetStyles.get(header);

            if (style.makeInvisible) {
                // we will have already removed the 'display: none', so add it back.
                header.style.display = "none";
                continue; // nothing else to do, even if sticky somehow
            }

            if (style.stickyTop) {
                if (!header.classList.contains("mx_RoomSublist_headerContainer_stickyTop")) {
                    header.classList.add("mx_RoomSublist_headerContainer_stickyTop");
                }

                const newTop = `${list.parentElement.offsetTop}px`;
                if (header.style.top !== newTop) {
                    header.style.top = newTop;
                }
            } else {
                if (header.classList.contains("mx_RoomSublist_headerContainer_stickyTop")) {
                    header.classList.remove("mx_RoomSublist_headerContainer_stickyTop");
                }
                if (header.style.top) {
                    header.style.removeProperty('top');
                }
            }

            if (style.stickyBottom) {
                if (!header.classList.contains("mx_RoomSublist_headerContainer_stickyBottom")) {
                    header.classList.add("mx_RoomSublist_headerContainer_stickyBottom");
                }

                const offset = UIStore.instance.windowHeight -
                    (list.parentElement.offsetTop + list.parentElement.offsetHeight);
                const newBottom = `${offset}px`;
                if (header.style.bottom !== newBottom) {
                    header.style.bottom = newBottom;
                }
            } else {
                if (header.classList.contains("mx_RoomSublist_headerContainer_stickyBottom")) {
                    header.classList.remove("mx_RoomSublist_headerContainer_stickyBottom");
                }
                if (header.style.bottom) {
                    header.style.removeProperty('bottom');
                }
            }

            if (style.stickyTop || style.stickyBottom) {
                if (!header.classList.contains("mx_RoomSublist_headerContainer_sticky")) {
                    header.classList.add("mx_RoomSublist_headerContainer_sticky");
                }

                const listDimensions = UIStore.instance.getElementDimensions("ListContainer");
                if (listDimensions) {
                    const headerRightMargin = 15; // calculated from margins and widths to align with non-sticky tiles
                    const headerStickyWidth = listDimensions.width - headerRightMargin;
                    const newWidth = `${headerStickyWidth}px`;
                    if (header.style.width !== newWidth) {
                        header.style.width = newWidth;
                    }
                }
            } else if (!style.stickyTop && !style.stickyBottom) {
                if (header.classList.contains("mx_RoomSublist_headerContainer_sticky")) {
                    header.classList.remove("mx_RoomSublist_headerContainer_sticky");
                }

                if (header.style.width) {
                    header.style.removeProperty('width');
                }
            }
        }

        // add appropriate sticky classes to wrapper so it has
        // the necessary top/bottom padding to put the sticky header in
        const listWrapper = list.parentElement; // .mx_LeftPanel_roomListWrapper
        if (lastTopHeader) {
            listWrapper.classList.add("mx_LeftPanel_roomListWrapper_stickyTop");
        } else {
            listWrapper.classList.remove("mx_LeftPanel_roomListWrapper_stickyTop");
        }
        if (firstBottomHeader) {
            listWrapper.classList.add("mx_LeftPanel_roomListWrapper_stickyBottom");
        } else {
            listWrapper.classList.remove("mx_LeftPanel_roomListWrapper_stickyBottom");
        }
    }

    private onScroll = (ev: Event) => {
        const list = ev.target as HTMLDivElement;
        this.handleStickyHeaders(list);
    };

    private onFocus = (ev: React.FocusEvent) => {
        this.focusedElement = ev.target;
    };

    private onBlur = () => {
        this.focusedElement = null;
    };

    private onKeyDown = (ev: React.KeyboardEvent, state?: IRovingTabIndexState) => {
        if (!this.focusedElement) return;

        const action = getKeyBindingsManager().getRoomListAction(ev);
        switch (action) {
            case KeyBindingAction.NextRoom:
                if (!state) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    this.roomListRef.current?.focus();
                }
                break;

            case KeyBindingAction.PrevRoom:
                if (state && state.activeRef === findSiblingElement(state.refs, 0)) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    this.roomSearchRef.current?.focus();
                }
                break;
        }
    };

    private onRoomListKeydown = (ev: React.KeyboardEvent) => {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
        if (SettingsStore.getValue("feature_spotlight")) return;
        // we cannot handle Space as that is an activation key for all focusable elements in this widget
        if (ev.key.length === 1) {
            ev.preventDefault();
            ev.stopPropagation();
            this.roomSearchRef.current?.appendChar(ev.key);
        } else if (ev.key === Key.BACKSPACE) {
            ev.preventDefault();
            ev.stopPropagation();
            this.roomSearchRef.current?.backspace();
        }
    };

    private selectRoom = () => {
        const firstRoom = this.listContainerRef.current.querySelector<HTMLDivElement>(".mx_RoomTile");
        if (firstRoom) {
            firstRoom.click();
            return true; // to get the field to clear
        }
    };

    private renderBreadcrumbs(): React.ReactNode {
        if (this.state.showBreadcrumbs === BreadcrumbsMode.Legacy && !this.props.isMinimized) {
            return (
                <IndicatorScrollbar
                    className="mx_LeftPanel_breadcrumbsContainer mx_AutoHideScrollbar"
                    verticalScrollsHorizontally={true}
                >
                    <RoomBreadcrumbs />
                </IndicatorScrollbar>
            );
        }
    }

    private renderSearchDialExplore(): React.ReactNode {
        let dialPadButton = null;

        // If we have dialer support, show a button to bring up the dial pad
        // to start a new call
        if (CallHandler.instance.getSupportsPstnProtocol()) {
            dialPadButton =
                <AccessibleTooltipButton
                    className={classNames("mx_LeftPanel_dialPadButton", {})}
                    onClick={this.onDialPad}
                    title={_t("Open dial pad")}
                />;
        }

        let rightButton: JSX.Element;
        if (this.state.showBreadcrumbs === BreadcrumbsMode.Labs) {
            rightButton = <RecentlyViewedButton />;
        // SC: Always show explore button in any space
        // eslint-disable-next-line no-constant-condition
        } else if (true || this.state.activeSpace === MetaSpace.Home) {
            rightButton = <AccessibleTooltipButton
                className="mx_LeftPanel_exploreButton"
                onClick={this.onExplore}
                title={_t("Explore rooms")}
            />;
        }

        return (
            <div
                className="mx_LeftPanel_filterContainer"
                onFocus={this.onFocus}
                onBlur={this.onBlur}
                onKeyDown={this.onKeyDown}
            >
                { !SpaceStore.spacesEnabled && <UserMenu isPanelCollapsed={true} /> }
                <RoomSearch
                    isMinimized={this.props.isMinimized}
                    ref={this.roomSearchRef}
                    onSelectRoom={this.selectRoom}
                />

                { dialPadButton }
                { rightButton }
            </div>
        );
    }

    public render(): React.ReactNode {
        const roomList = <RoomList
            onKeyDown={this.onKeyDown}
            resizeNotifier={this.props.resizeNotifier}
            onFocus={this.onFocus}
            onBlur={this.onBlur}
            isMinimized={this.props.isMinimized}
            activeSpace={this.state.activeSpace}
            onResize={this.refreshStickyHeaders}
            onListCollapse={this.refreshStickyHeaders}
            ref={this.roomListRef}
        />;

        const containerClasses = classNames({
            "mx_LeftPanel": true,
            "mx_LeftPanel_minimized": this.props.isMinimized,
        });

        const roomListClasses = classNames(
            "mx_LeftPanel_actualRoomListContainer",
            "mx_AutoHideScrollbar",
        );

        return (
            <div className={containerClasses} ref={this.ref}>
                <aside className="mx_LeftPanel_roomListContainer">
                    { this.renderSearchDialExplore() }
                    { this.renderBreadcrumbs() }
                    { !this.props.isMinimized && (
                        <RoomListHeader
                            onVisibilityChange={this.refreshStickyHeaders}
                            spacePanelDisabled={!SpaceStore.spacesEnabled}
                        />
                    ) }
                    <div className="mx_LeftPanel_roomListWrapper">
                        <div
                            className={roomListClasses}
                            ref={this.listContainerRef}
                            // Firefox sometimes makes this element focusable due to
                            // overflow:scroll;, so force it out of tab order.
                            tabIndex={-1}
                            onKeyDown={this.onRoomListKeydown}
                        >
                            { roomList }
                        </div>
                    </div>
                    { !this.props.isMinimized && <LeftPanelWidget /> }
                </aside>
            </div>
        );
    }
}
