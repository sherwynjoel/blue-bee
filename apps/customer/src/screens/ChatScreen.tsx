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
import { Button, EmptyState, Input, Text } from '../../components/ui';

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
 * Customer ↔ driver chat for one order (Increment 18, PRD §7A A6.1 / §6.1). Message list (sender-
 * aligned bubbles + timestamps), a live socket for incoming messages, and a composer that DISABLES
 * with a clear "chat closes after delivery" state once the order leaves its active delivery window
 * (server-enforced — the composer just reflects `open`). History stays readable after close.
 */
export function ChatScreen({ route }: { navigation: Nav; route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client, me } = useSession();
  const { colors, space, radius } = useTheme();
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
                borderColor: mine ? colors.azure : colors.hairline,
                borderTopRightRadius: mine ? 4 : radius.card,
                borderTopLeftRadius: mine ? radius.card : 4,
              },
            ]}
          >
            <Text variant="body" style={{ color: mine ? colors.onAzure : colors.text }}>
              {item.body}
            </Text>
            <Text variant="caption" style={{ color: mine ? colors.onAzure : colors.textTertiary, opacity: mine ? 0.85 : 1, marginTop: 3, alignSelf: 'flex-end' }}>
              {clock(item.sentAt)}
            </Text>
          </View>
        </View>
      );
    },
    [myUserId, colors, radius],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
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
            <Button testID="load-earlier" label="Load earlier messages" variant="ghost" size="sm" onPress={chat.loadOlder} haptic="selection" />
          ) : null
        }
        ListEmptyComponent={
          chat.phase === 'ready' ? (
            <EmptyState
              icon="message-circle"
              title="No messages yet"
              body={chat.open ? 'Send your driver a message about this delivery.' : 'There are no messages for this order.'}
            />
          ) : null
        }
      />

      {chat.error ? (
        <View style={[styles.banner, { backgroundColor: colors.dangerTint }]}>
          <Feather name="alert-circle" size={15} color={colors.danger} />
          <Text variant="footnote" color="danger" style={styles.bannerText}>
            {chat.error}
          </Text>
        </View>
      ) : null}

      {chat.open ? (
        <View style={[styles.composer, { borderTopColor: colors.hairline, backgroundColor: colors.canvas }]}>
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
            style={[styles.sendBtn, { backgroundColor: draft.trim() && !chat.sending ? colors.azure : colors.subtle }]}
          >
            <Feather name="send" size={18} color={draft.trim() && !chat.sending ? colors.onAzure : colors.textTertiary} />
          </Pressable>
        </View>
      ) : (
        <View testID="chat-readonly" style={[styles.readOnly, { borderTopColor: colors.hairline, backgroundColor: colors.subtle }]}>
          <Feather name="lock" size={15} color={colors.textTertiary} />
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
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '80%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { flex: 1 },
});
