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

import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "matrix-js-sdk/src/models/room";
import { RoomHierarchy } from "matrix-js-sdk/src/room-hierarchy";
import { EventType, RoomType } from "matrix-js-sdk/src/@types/event";
import { IHierarchyRelation, IHierarchyRoom } from "matrix-js-sdk/src/@types/spaces";
import classNames from "classnames";
import { sortBy } from "lodash";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import dis from "../../dispatcher/dispatcher";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { _t } from "../../languageHandler";
import AccessibleButton, { ButtonEvent } from "../views/elements/AccessibleButton";
import Spinner from "../views/elements/Spinner";
import SearchBox from "./SearchBox";
import RoomAvatar from "../views/avatars/RoomAvatar";
import StyledCheckbox from "../views/elements/StyledCheckbox";
import BaseAvatar from "../views/avatars/BaseAvatar";
import { mediaFromMxc } from "../../customisations/Media";
import InfoTooltip from "../views/elements/InfoTooltip";
import TextWithTooltip from "../views/elements/TextWithTooltip";
import { useStateToggle } from "../../hooks/useStateToggle";
import { getChildOrder } from "../../stores/SpaceStore";
import AccessibleTooltipButton from "../views/elements/AccessibleTooltipButton";
import { linkifyElement } from "../../HtmlUtils";
import { useDispatcher } from "../../hooks/useDispatcher";
import { Action } from "../../dispatcher/actions";
import { getDisplayAliasForRoom } from "./RoomDirectory";

interface IProps {
    space: Room;
    initialText?: string;
    additionalButtons?: ReactNode;
    showRoom(hierarchy: RoomHierarchy, roomId: string, autoJoin?: boolean): void;
}

interface ITileProps {
    room: IHierarchyRoom;
    suggested?: boolean;
    selected?: boolean;
    numChildRooms?: number;
    hasPermissions?: boolean;
    onViewRoomClick(autoJoin: boolean): void;
    onToggleClick?(): void;
}

const Tile: React.FC<ITileProps> = ({
    room,
    suggested,
    selected,
    hasPermissions,
    onToggleClick,
    onViewRoomClick,
    numChildRooms,
    children,
}) => {
    const cli = MatrixClientPeg.get();
    const joinedRoom = cli.getRoom(room.room_id)?.getMyMembership() === "join" ? cli.getRoom(room.room_id) : null;
    const name = joinedRoom?.name || room.name || room.canonical_alias || room.aliases?.[0]
        || (room.room_type === RoomType.Space ? _t("Unnamed Space") : _t("Unnamed Room"));

    const [showChildren, toggleShowChildren] = useStateToggle(true);

    const onPreviewClick = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        onViewRoomClick(false);
    };
    const onJoinClick = (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        onViewRoomClick(true);
    };

    let button;
    if (joinedRoom) {
        button = <AccessibleButton onClick={onPreviewClick} kind="primary_outline">
            { _t("View") }
        </AccessibleButton>;
    } else if (onJoinClick) {
        button = <AccessibleButton onClick={onJoinClick} kind="primary">
            { _t("Join") }
        </AccessibleButton>;
    }

    let checkbox;
    if (onToggleClick) {
        if (hasPermissions) {
            checkbox = <StyledCheckbox checked={!!selected} onChange={onToggleClick} />;
        } else {
            checkbox = <TextWithTooltip
                tooltip={_t("You don't have permission")}
                onClick={ev => { ev.stopPropagation(); }}
            >
                <StyledCheckbox disabled={true} />
            </TextWithTooltip>;
        }
    }

    let avatar;
    if (joinedRoom) {
        avatar = <RoomAvatar room={joinedRoom} width={20} height={20} />;
    } else {
        avatar = <BaseAvatar
            name={name}
            idName={room.room_id}
            url={room.avatar_url ? mediaFromMxc(room.avatar_url).getSquareThumbnailHttp(20) : null}
            width={20}
            height={20}
        />;
    }

    let description = _t("%(count)s members", { count: room.num_joined_members });
    if (numChildRooms !== undefined) {
        description += " · " + _t("%(count)s rooms", { count: numChildRooms });
    }

    const topic = joinedRoom?.currentState?.getStateEvents(EventType.RoomTopic, "")?.getContent()?.topic || room.topic;
    if (topic) {
        description += " · " + topic;
    }

    let suggestedSection;
    if (suggested) {
        suggestedSection = <InfoTooltip tooltip={_t("This room is suggested as a good one to join")}>
            { _t("Suggested") }
        </InfoTooltip>;
    }

    const content = <React.Fragment>
        { avatar }
        <div className="mx_SpaceHierarchy_roomTile_name">
            { name }
            { suggestedSection }
        </div>

        <div
            className="mx_SpaceHierarchy_roomTile_info"
            ref={e => e && linkifyElement(e)}
            onClick={ev => {
                // prevent clicks on links from bubbling up to the room tile
                if ((ev.target as HTMLElement).tagName === "A") {
                    ev.stopPropagation();
                }
            }}
        >
            { description }
        </div>
        <div className="mx_SpaceHierarchy_actions">
            { button }
            { checkbox }
        </div>
    </React.Fragment>;

    let childToggle;
    let childSection;
    if (children) {
        // the chevron is purposefully a div rather than a button as it should be ignored for a11y
        childToggle = <div
            className={classNames("mx_SpaceHierarchy_subspace_toggle", {
                mx_SpaceHierarchy_subspace_toggle_shown: showChildren,
            })}
            onClick={ev => {
                ev.stopPropagation();
                toggleShowChildren();
            }}
        />;
        if (showChildren) {
            childSection = <div className="mx_SpaceHierarchy_subspace_children">
                { children }
            </div>;
        }
    }

    return <>
        <AccessibleButton
            className={classNames("mx_SpaceHierarchy_roomTile", {
                mx_SpaceHierarchy_subspace: room.room_type === RoomType.Space,
            })}
            onClick={(hasPermissions && onToggleClick) ? onToggleClick : onPreviewClick}
        >
            { content }
            { childToggle }
        </AccessibleButton>
        { childSection }
    </>;
};

export const showRoom = (hierarchy: RoomHierarchy, roomId: string, autoJoin = false) => {
    const room = hierarchy.roomMap.get(roomId);

    // Don't let the user view a room they won't be able to either peek or join:
    // fail earlier so they don't have to click back to the directory.
    if (MatrixClientPeg.get().isGuest()) {
        if (!room.world_readable && !room.guest_can_join) {
            dis.dispatch({ action: "require_registration" });
            return;
        }
    }

    const roomAlias = getDisplayAliasForRoom(room) || undefined;
    dis.dispatch({
        action: "view_room",
        auto_join: autoJoin,
        should_peek: true,
        _type: "room_directory", // instrumentation
        room_alias: roomAlias,
        room_id: room.room_id,
        via_servers: Array.from(hierarchy.viaMap.get(roomId) || []),
        oob_data: {
            avatarUrl: room.avatar_url,
            // XXX: This logic is duplicated from the JS SDK which would normally decide what the name is.
            name: room.name || roomAlias || _t("Unnamed room"),
        },
    });
};

interface IHierarchyLevelProps {
    root: IHierarchyRoom;
    roomSet: Set<IHierarchyRoom>;
    hierarchy: RoomHierarchy;
    parents: Set<string>;
    selectedMap?: Map<string, Set<string>>;
    onViewRoomClick(roomId: string, autoJoin: boolean): void;
    onToggleClick?(parentId: string, childId: string): void;
}

export const HierarchyLevel = ({
    root,
    roomSet,
    hierarchy,
    parents,
    selectedMap,
    onViewRoomClick,
    onToggleClick,
}: IHierarchyLevelProps) => {
    const cli = MatrixClientPeg.get();
    const space = cli.getRoom(root.room_id);
    const hasPermissions = space?.currentState.maySendStateEvent(EventType.SpaceChild, cli.getUserId());

    const sortedChildren = sortBy(root.children_state, ev => {
        return getChildOrder(ev.content.order, ev.origin_server_ts, ev.state_key);
    });

    const [subspaces, childRooms] = sortedChildren.reduce((result, ev: IHierarchyRelation) => {
        const room = hierarchy.roomMap.get(ev.state_key);
        if (room && roomSet.has(room)) {
            result[room.room_type === RoomType.Space ? 0 : 1].push(room);
        }
        return result;
    }, [[] as IHierarchyRoom[], [] as IHierarchyRoom[]]);

    const newParents = new Set(parents).add(root.room_id);
    return <React.Fragment>
        {
            childRooms.map(room => (
                <Tile
                    key={room.room_id}
                    room={room}
                    suggested={hierarchy.isSuggested(root.room_id, room.room_id)}
                    selected={selectedMap?.get(root.room_id)?.has(room.room_id)}
                    onViewRoomClick={(autoJoin) => {
                        onViewRoomClick(room.room_id, autoJoin);
                    }}
                    hasPermissions={hasPermissions}
                    onToggleClick={onToggleClick ? () => onToggleClick(root.room_id, room.room_id) : undefined}
                />
            ))
        }

        {
            subspaces.filter(room => !newParents.has(room.room_id)).map(space => (
                <Tile
                    key={space.room_id}
                    room={space}
                    numChildRooms={space.children_state.filter(ev => {
                        const room = hierarchy.roomMap.get(ev.state_key);
                        return room && roomSet.has(room) && !room.room_type;
                    }).length}
                    suggested={hierarchy.isSuggested(root.room_id, space.room_id)}
                    selected={selectedMap?.get(root.room_id)?.has(space.room_id)}
                    onViewRoomClick={(autoJoin) => {
                        onViewRoomClick(space.room_id, autoJoin);
                    }}
                    hasPermissions={hasPermissions}
                    onToggleClick={onToggleClick ? () => onToggleClick(root.room_id, space.room_id) : undefined}
                >
                    <HierarchyLevel
                        root={space}
                        roomSet={roomSet}
                        hierarchy={hierarchy}
                        parents={newParents}
                        selectedMap={selectedMap}
                        onViewRoomClick={onViewRoomClick}
                        onToggleClick={onToggleClick}
                    />
                </Tile>
            ))
        }
    </React.Fragment>;
};

const INITIAL_PAGE_SIZE = 20;

export const useSpaceSummary = (space: Room): {
    loading: boolean;
    rooms: IHierarchyRoom[];
    hierarchy: RoomHierarchy;
    loadMore(pageSize?: number): Promise <void>;
} => {
    const [rooms, setRooms] = useState<IHierarchyRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [hierarchy, setHierarchy] = useState<RoomHierarchy>();

    const resetHierarchy = useCallback(() => {
        const hierarchy = new RoomHierarchy(space, INITIAL_PAGE_SIZE);
        setHierarchy(hierarchy);

        let discard = false;
        hierarchy.load().then(() => {
            if (discard) return;
            setRooms(hierarchy.rooms);
            setLoading(false);
        });

        return () => {
            discard = true;
        };
    }, [space]);
    useEffect(resetHierarchy, [resetHierarchy]);

    useDispatcher(defaultDispatcher, (payload => {
        if (payload.action === Action.UpdateSpaceHierarchy) {
            setLoading(true);
            setRooms([]); // TODO
            resetHierarchy();
        }
    }));

    const loadMore = useCallback(async (pageSize?: number) => {
        if (!hierarchy.canLoadMore || hierarchy.noSupport) return;

        setLoading(true);
        await hierarchy.load(pageSize);
        setRooms(hierarchy.rooms);
        setLoading(false);
    }, [hierarchy]);

    return { loading, rooms, hierarchy, loadMore };
};

const useIntersectionObserver = (callback: () => void) => {
    const handleObserver = (entries: IntersectionObserverEntry[]) => {
        const target = entries[0];
        if (target.isIntersecting) {
            callback();
        }
    };

    const observerRef = useRef<IntersectionObserver>();
    return (element: HTMLDivElement) => {
        if (observerRef.current) {
            observerRef.current.disconnect();
        } else if (element) {
            observerRef.current = new IntersectionObserver(handleObserver, {
                root: element.parentElement,
                rootMargin: "0px 0px 600px 0px",
            });
        }

        if (observerRef.current && element) {
            observerRef.current.observe(element);
        }
    };
};

const SpaceHierarchy = ({
    space,
    initialText = "",
    showRoom,
    additionalButtons,
}: IProps) => {
    const cli = MatrixClientPeg.get();
    const userId = cli.getUserId();
    const [query, setQuery] = useState(initialText);

    const [selected, setSelected] = useState(new Map<string, Set<string>>()); // Map<parentId, Set<childId>>

    const { loading, rooms, hierarchy, loadMore } = useSpaceSummary(space);

    const filteredRoomSet = useMemo<Set<IHierarchyRoom>>(() => {
        if (!rooms.length) return new Set();
        const lcQuery = query.toLowerCase().trim();
        if (!lcQuery) return new Set(rooms);

        const directMatches = rooms.filter(r => {
            return r.name?.toLowerCase().includes(lcQuery) || r.topic?.toLowerCase().includes(lcQuery);
        });

        // Walk back up the tree to find all parents of the direct matches to show their place in the hierarchy
        const visited = new Set<string>();
        const queue = [...directMatches.map(r => r.room_id)];
        while (queue.length) {
            const roomId = queue.pop();
            visited.add(roomId);
            hierarchy.backRefs.get(roomId)?.forEach(parentId => {
                if (!visited.has(parentId)) {
                    queue.push(parentId);
                }
            });
        }

        return new Set(rooms.filter(r => visited.has(r.room_id)));
    }, [rooms, hierarchy, query]);

    const [error, setError] = useState("");
    const [removing, setRemoving] = useState(false);
    const [saving, setSaving] = useState(false);

    const loaderRef = useIntersectionObserver(loadMore);

    if (!loading && hierarchy.noSupport) {
        return <p>{ _t("Your server does not support showing space hierarchies.") }</p>;
    }

    let content: JSX.Element;
    let loader: JSX.Element;
    if (loading) {
        content = <Spinner />;
    } else {
        let manageButtons;
        if (space.getMyMembership() === "join" && space.currentState.maySendStateEvent(EventType.SpaceChild, userId)) {
            const selectedRelations = Array.from(selected.keys()).flatMap(parentId => {
                return [...selected.get(parentId).values()].map(childId => [parentId, childId]) as [string, string][];
            });

            const selectionAllSuggested = selectedRelations.every(([parentId, childId]) => {
                return hierarchy.isSuggested(parentId, childId);
            });

            const disabled = !selectedRelations.length || removing || saving;

            let Button: React.ComponentType<React.ComponentProps<typeof AccessibleButton>> = AccessibleButton;
            let props = {};
            if (!selectedRelations.length) {
                Button = AccessibleTooltipButton;
                props = {
                    tooltip: _t("Select a room below first"),
                    yOffset: -40,
                };
            }

            manageButtons = <>
                <Button
                    {...props}
                    onClick={async () => {
                        setRemoving(true);
                        try {
                            for (const [parentId, childId] of selectedRelations) {
                                await cli.sendStateEvent(parentId, EventType.SpaceChild, {}, childId);

                                hierarchy.removeRelation(parentId, childId);
                            }
                        } catch (e) {
                            setError(_t("Failed to remove some rooms. Try again later"));
                        }
                        setRemoving(false);
                        setSelected(new Map());
                    }}
                    kind="danger_outline"
                    disabled={disabled}
                >
                    { removing ? _t("Removing...") : _t("Remove") }
                </Button>
                <Button
                    {...props}
                    onClick={async () => {
                        setSaving(true);
                        try {
                            for (const [parentId, childId] of selectedRelations) {
                                const suggested = !selectionAllSuggested;
                                const existingContent = hierarchy.getRelation(parentId, childId)?.content;
                                if (!existingContent || existingContent.suggested === suggested) continue;

                                const content = {
                                    ...existingContent,
                                    suggested: !selectionAllSuggested,
                                };

                                await cli.sendStateEvent(parentId, EventType.SpaceChild, content, childId);

                                // mutate the local state to save us having to refetch the world
                                existingContent.suggested = content.suggested;
                            }
                        } catch (e) {
                            setError("Failed to update some suggestions. Try again later");
                        }
                        setSaving(false);
                        setSelected(new Map());
                    }}
                    kind="primary_outline"
                    disabled={disabled}
                >
                    { saving
                        ? _t("Saving...")
                        : (selectionAllSuggested ? _t("Mark as not suggested") : _t("Mark as suggested"))
                    }
                </Button>
            </>;
        }

        let results: JSX.Element;
        if (filteredRoomSet.size) {
            const hasPermissions = space?.currentState.maySendStateEvent(EventType.SpaceChild, cli.getUserId());

            results = <>
                <HierarchyLevel
                    root={hierarchy.roomMap.get(space.roomId)}
                    roomSet={filteredRoomSet}
                    hierarchy={hierarchy}
                    parents={new Set()}
                    selectedMap={selected}
                    onToggleClick={hasPermissions ? (parentId, childId) => {
                        setError("");
                        if (!selected.has(parentId)) {
                            setSelected(new Map(selected.set(parentId, new Set([childId]))));
                            return;
                        }

                        const parentSet = selected.get(parentId);
                        if (!parentSet.has(childId)) {
                            setSelected(new Map(selected.set(parentId, new Set([...parentSet, childId]))));
                            return;
                        }

                        parentSet.delete(childId);
                        setSelected(new Map(selected.set(parentId, new Set(parentSet))));
                    } : undefined}
                    onViewRoomClick={(roomId, autoJoin) => {
                        showRoom(hierarchy, roomId, autoJoin);
                    }}
                />
            </>;

            loader = <div ref={loaderRef}>
                <Spinner />
            </div>;
        } else {
            results = <div className="mx_SpaceHierarchy_noResults">
                <h3>{ _t("No results found") }</h3>
                <div>{ _t("You may want to try a different search or check for typos.") }</div>
            </div>;
        }

        content = <>
            <div className="mx_SpaceHierarchy_listHeader">
                <h4>{ query.trim() ? _t("Results") : _t("Rooms and spaces") }</h4>
                <span>
                    { additionalButtons }
                    { manageButtons }
                </span>
            </div>
            { error && <div className="mx_SpaceHierarchy_error">
                { error }
            </div> }

            { results }
            { loader }
        </>;
    }

    return <>
        <SearchBox
            className="mx_textinput_icon mx_textinput_search"
            placeholder={_t("Search names and descriptions")}
            onSearch={setQuery}
            autoFocus={true}
            initialValue={initialText}
        />

        { content }
    </>;
};

export default SpaceHierarchy;
