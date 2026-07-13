import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ChatMessageDto } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useDriverChat } from '../chat/useDriverChat';
import type { OutboxItem } from '../chat/outbox-store';
import { useTheme } from '../theme';
import { Button, EmptyState, Input, Text } from '../components/kit';
import type { ChatProps } from '../navigation';

/** Local, Intl-free clock: "2:45 PM". */
function clock(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m < 10 ? `0${m}` : m} ${ampm}`;
}

type Row = { kind: 'msg'; msg: ChatMessageDto } | { kind: 'pending'; item: OutboxItem };

/**
 * Driver ↔ customer chat for the stop's order (Increment 18). Mirrors the customer screen but is
 * OFFLINE-FIRST: a message composed with no signal is QUEUED (clock icon) and synced later; a
 * permanent rejection shows a "couldn't send" state — delivery is never faked. The composer disables
 * with a clear read-only note once the stop completes (server-enforced; the composer reflects `open`).
 */
export function ChatScreen({ route }: ChatProps): React.ReactElement {
  const t = useTheme();
  const { orderId } = route.params;
  const { client, me } = useSession();
  const myUserId = me?.user.userId ?? null;

  const chat = useDriverChat(client, orderId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Row>>(null);

  const rows: Row[] = [
    ...chat.messages.map((msg): Row => ({ kind: 'msg', msg })),
    ...chat.pending.map((item): Row => ({ kind: 'pending', item })),
  ];

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);
  useEffect(() => {
    if (rows.length) scrollToEnd();
  }, [rows.length, scrollToEnd]);

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (!body || !chat.open) return;
    setDraft('');
    chat.send(body);
  }, [draft, chat]);

  const bubble = (mine: boolean, body: string, footer: React.ReactNode) => (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? t.color.azure : t.color.surface,
            borderColor: mine ? t.color.azure : t.color.hairline,
            borderTopRightRadius: mine ? 4 : 16,
            borderTopLeftRadius: mine ? 16 : 4,
          },
        ]}
      >
        <Text variant="body" color={mine ? t.color.onAzure : t.color.text}>
          {body}
        </Text>
        <View style={styles.footer}>{footer}</View>
      </View>
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'msg') {
        const mine = !!myUserId && item.msg.fromUserId === myUserId;
        return bubble(
          mine,
          item.msg.body,
          <Text variant="caption" color={mine ? t.color.onAzure : t.color.textFaint}>
            {clock(item.msg.sentAt)}
          </Text>,
        );
      }
      // Pending (always mine): honest queued / failed indicator — never a "sent" checkmark.
      const failed = item.item.status === 'failed';
      return bubble(
        true,
        item.item.body,
        <View style={styles.pendingFooter} testID={failed ? 'chat-failed' : 'chat-queued'}>
          <Feather name={failed ? 'alert-circle' : 'clock'} size={11} color={failed ? t.color.dangerInk : t.color.onAzure} />
          <Text variant="caption" color={failed ? t.color.dangerInk : t.color.onAzure}>
            {failed ? "couldn't send" : 'queued'}
          </Text>
        </View>,
      );
    },
    [myUserId, t],
  );

  if (chat.phase === 'error') {
    return <EmptyState icon="alert-circle" title="Couldn't load messages" message="Pull back and try again." />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: t.color.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={listRef}
        testID="chat-list"
        data={rows}
        keyExtractor={(r) => (r.kind === 'msg' ? r.msg.id : `p-${r.item.id}`)}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, rows.length === 0 && styles.listEmpty]}
        onContentSizeChange={scrollToEnd}
        ListHeaderComponent={
          chat.hasMore ? <Button label="Load earlier messages" variant="ghost" onPress={chat.loadOlder} fullWidth /> : null
        }
        ListEmptyComponent={
          chat.phase === 'ready' ? (
            <EmptyState
              icon="message-circle"
              title="No messages yet"
              message={chat.open ? 'Message the customer about this delivery.' : 'There are no messages for this order.'}
            />
          ) : null
        }
      />

      {chat.open ? (
        <View style={[styles.composer, { borderTopColor: t.color.hairline, backgroundColor: t.color.canvas }]}>
          <View style={styles.flex}>
            <Input testID="chat-composer" value={draft} onChangeText={setDraft} placeholder="Message the customer…" autoCapitalize="sentences" />
          </View>
          <Pressable
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={onSend}
            disabled={!draft.trim()}
            style={[styles.sendBtn, { backgroundColor: draft.trim() ? t.color.azure : t.color.subtle }]}
          >
            <Feather name="send" size={18} color={draft.trim() ? t.color.onAzure : t.color.textFaint} />
          </Pressable>
        </View>
      ) : (
        <View testID="chat-readonly" style={[styles.readOnly, { borderTopColor: t.color.hairline, backgroundColor: t.color.subtle }]}>
          <Feather name="lock" size={15} color={t.color.textFaint} />
          <Text variant="footnote" color={t.color.textMuted}>
            Chat closes after the stop completes — this conversation is now read-only.
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
  footer: { alignSelf: 'flex-end', marginTop: 3 },
  pendingFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
