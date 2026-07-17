import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ChatMessageDto } from '@blue-bee/shared';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { useOrderChat } from '../chat/useOrderChat';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Button, EmptyState, IconBadge, Input, Skeleton, Text } from '../../components/ui';

type Nav = NavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Chat'>;

/** Local, Intl-free clock (Hermes-safe): "2:45 PM". */
function clock(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m < 10 ? `0${m}` : m} ${ampm}`;
}

/**
 * Customer ↔ driver chat for one order (Increment 18, PRD §7A A6.1 / §6.1). [Royal restyle] Message
 * list (sender-aligned bubbles + timestamps), a live socket for incoming messages, and a composer that
 * DISABLES with a clear "chat closes after delivery" state once the order leaves its active delivery
 * window (server-enforced — the composer just reflects `open`). History stays readable after close.
 * Purely a presentation pass: the ChatController's REST-truth / WS-optimisation wiring, every testID,
 * and the loading/error/empty/data states are unchanged — only what's rendered is restyled.
 */
export function ChatScreen({ route }: { navigation: Nav; route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client, me } = useSession();
  const { colors, radius, space, elevation } = useTheme();
  const myUserId = me?.user.userId ?? null;

  const chat = useOrderChat(client, orderId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessageDto>>(null);

  // Keep the newest message in view as the thread grows.
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);
  useEffect(() => {
    if (chat.messages.length) scrollToEnd();
  }, [chat.messages.length, scrollToEnd]);

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (!body || !chat.open || chat.sending) return;
    setDraft('');
    chat.send(body);
  }, [draft, chat]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessageDto>) => {
      const mine = !!myUserId && item.fromUserId === myUserId;
      return (
        <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: mine ? colors.azure : colors.surface,
                borderColor: mine ? 'transparent' : colors.hairline,
                borderWidth: mine ? 0 : StyleSheet.hairlineWidth,
                borderRadius: radius.card,
                borderTopRightRadius: mine ? 4 : radius.card,
                borderTopLeftRadius: mine ? radius.card : 4,
              },
            ]}
          >
            <Text variant="body" style={{ color: mine ? colors.onAzure : colors.text }}>
              {item.body}
            </Text>
            <Text
              variant="caption"
              style={{
                color: mine ? colors.onAzure : colors.textTertiary,
                opacity: mine ? 0.8 : 1,
                marginTop: space.xs,
                alignSelf: 'flex-end',
              }}
            >
              {clock(item.sentAt)}
            </Text>
          </View>
        </View>
      );
    },
    [myUserId, colors, radius, space],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Initial history fetch — a few bubble-shaped skeletons instead of a blank canvas. */}
      {chat.phase === 'loading' ? (
        <View style={styles.listContent} testID="chat-loading">
          <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
            <Skeleton width={180} height={46} radius={radius.card} />
          </View>
          <View style={[styles.bubbleRow, { justifyContent: 'flex-end' }]}>
            <Skeleton width={140} height={38} radius={radius.card} />
          </View>
          <View style={[styles.bubbleRow, { justifyContent: 'flex-start' }]}>
            <Skeleton width={210} height={58} radius={radius.card} />
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          testID="chat-list"
          data={chat.messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, chat.messages.length === 0 && styles.listEmpty]}
          onContentSizeChange={scrollToEnd}
          ListHeaderComponent={
            chat.hasMore ? (
              <View style={styles.loadEarlier}>
                <Button
                  testID="load-earlier"
                  label="Load earlier messages"
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  onPress={chat.loadOlder}
                  haptic="selection"
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            chat.phase === 'ready' ? (
              <EmptyState
                icon="message-circle"
                title="No messages yet"
                body={chat.open ? 'Send your driver a message about this delivery.' : 'There are no messages for this order.'}
              />
            ) : chat.phase === 'error' ? (
              <EmptyState
                icon="wifi-off"
                tone="neutral"
                title="Couldn’t load this conversation"
                body={chat.error ?? 'Please check your connection and try again.'}
              />
            ) : null
          }
        />
      )}

      {chat.error ? (
        <View style={[styles.banner, { backgroundColor: colors.dangerTint }]}>
          <IconBadge icon="alert-circle" tone="danger" size={26} />
          <Text variant="footnote" color="danger" style={styles.bannerText}>
            {chat.error}
          </Text>
        </View>
      ) : null}

      {chat.phase === 'loading' ? null : chat.open ? (
        <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.hairline }, elevation.e1]}>
          <Input
            testID="chat-composer"
            containerStyle={styles.flex}
            placeholder="Message your driver…"
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!chat.sending}
            onSubmitEditing={onSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={onSend}
            disabled={!draft.trim() || chat.sending}
            style={[
              styles.sendBtn,
              { borderRadius: radius.pill, backgroundColor: draft.trim() && !chat.sending ? colors.azure : colors.subtle },
              draft.trim() && !chat.sending ? elevation.e1 : null,
            ]}
          >
            <Feather name="send" size={18} color={draft.trim() && !chat.sending ? colors.onAzure : colors.textTertiary} />
          </Pressable>
        </View>
      ) : (
        <View testID="chat-readonly" style={[styles.readOnly, { backgroundColor: colors.subtle, borderTopColor: colors.hairline }]}>
          <IconBadge icon="lock" tone="neutral" size={26} />
          <Text variant="footnote" color="tertiary" style={styles.bannerText}>
            Chat closes after delivery — this conversation is now read-only.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: 16, gap: 8, paddingBottom: 12 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  loadEarlier: { alignItems: 'center', marginBottom: 4 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sendBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { flex: 1 },
});
