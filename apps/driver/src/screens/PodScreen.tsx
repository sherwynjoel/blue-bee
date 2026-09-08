import React, { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { useSession } from '../session/SessionProvider';
import { ApiError } from '../api/problem';
import { capturePod, oneShotGeo, pickDeliveryPhoto, PodCaptureError, type PickedAsset } from '../media/pod-capture';
import { Badge, Button, Card, Text, haptics, useTheme } from '@blue-bee/ui';
import { Screen, useToast } from '../components/kit';
import type { PodProps } from '../navigation';

const SIGNATURE_HEIGHT = 220;

/**
 * Proof of delivery (Increment 17) — at a DELIVERY stop the driver captures a delivery PHOTO + a
 * SIGNATURE + the device GEO, uploads both via the real media path, POSTs the POD, and only THEN
 * completes the stop (server-authoritative — the §5.4 complete is never faked locally). Daylight-
 * styled, haptic, with real loading/error states; a failure keeps the captured inputs so the driver
 * can retry without re-capturing (the POD is idempotent server-side).
 */
export function PodScreen({ route, navigation }: PodProps): React.ReactElement {
  const t = useTheme();
  const { stopId } = route.params;
  const { assignment, client, doStopAction } = useSession();
  const { toast, node: toastNode } = useToast();

  const stop = assignment?.route?.stops.find((s) => s.id === stopId) ?? null;
  const sigRef = useRef<SignatureViewRef>(null);
  const [photo, setPhoto] = useState<PickedAsset | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState<'photo' | 'submit' | null>(null);
  const [podCaptured, setPodCaptured] = useState(false);

  const takePhoto = async (): Promise<void> => {
    setBusy('photo');
    try {
      const picked = await pickDeliveryPhoto();
      if (picked) {
        setPhoto(picked);
        haptics.tap();
      }
    } catch (e) {
      haptics.error();
      toast(e instanceof PodCaptureError ? e.message : 'Could not open the camera.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  // The signature pad confirms via readSignature() → onOK (base64 PNG) / onEmpty.
  const confirmSignature = (): void => sigRef.current?.readSignature();
  const clearSignature = (): void => {
    sigRef.current?.clearSignature();
    setSignature(null);
  };

  const submit = async (): Promise<void> => {
    if (!photo || !signature) return;
    setBusy('submit');
    try {
      if (!podCaptured) {
        const geo = await oneShotGeo(); // optional — never blocks on a denied/absent fix
        await capturePod(client, stopId, { photo, signatureBase64: signature, geo });
        setPodCaptured(true); // a complete-only retry won't re-upload
      }
      await doStopAction(stopId, 'complete'); // server-authoritative; re-syncs the assignment
      haptics.success();
      toast('Delivered — proof of delivery captured.', 'success');
      navigation.goBack();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        haptics.warning();
        toast('The office updated this stop — showing the latest.', 'warning');
        navigation.goBack();
      } else {
        haptics.error();
        toast(e instanceof ApiError || e instanceof PodCaptureError ? e.message : 'Could not capture proof. Please try again.', 'danger');
      }
    } finally {
      setBusy(null);
    }
  };

  const ready = !!photo && !!signature && busy === null;
  const signaturePadStyle = `.m-signature-pad{box-shadow:none;border:none;margin:0;}.m-signature-pad--body{border:none;}.m-signature-pad--footer{display:none;margin:0;}body,html{height:${SIGNATURE_HEIGHT}px;margin:0;}`;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <Screen scroll>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text variant="title2" style={{ flex: 1 }}>
              Proof of delivery
            </Text>
            <Badge tone="azure" icon="camera">
              Delivery
            </Badge>
          </View>
          <Text variant="subhead" color={t.colors.textSecondary} style={{ marginTop: 4 }}>
            {stop?.siteName ?? 'Delivery stop'} — capture a photo + signature to complete this delivery.
          </Text>
        </Card>

        <View style={{ height: t.space.lg }} />

        {/* Step 1 — delivery photo */}
        <Card>
          <Text variant="headline" style={{ marginBottom: t.space.sm }}>
            1 · Delivery photo
          </Text>
          {photo ? (
            <View style={{ gap: t.space.sm }}>
              <Image
                source={{ uri: photo.uri }}
                testID="pod-photo-preview"
                style={{ width: '100%', height: 200, borderRadius: t.radius.card, backgroundColor: t.colors.subtle }}
                resizeMode="cover"
              />
              <Button testID="pod-retake" label="Retake photo" onPress={() => void takePhoto()} tone="neutral" variant="outline" size="md" icon="refresh-cw" busy={busy === 'photo'} disabled={busy !== null} fullWidth />
            </View>
          ) : (
            <Button testID="pod-take-photo" label="Take delivery photo" onPress={() => void takePhoto()} icon="camera" size="md" busy={busy === 'photo'} disabled={busy !== null} fullWidth />
          )}
        </Card>

        <View style={{ height: t.space.lg }} />

        {/* Step 2 — signature */}
        <Card>
          <Text variant="headline" style={{ marginBottom: t.space.sm }}>
            2 · Recipient signature
          </Text>
          {signature ? (
            <View style={{ gap: t.space.sm }}>
              <View style={{ alignItems: 'center', paddingVertical: t.space.md, borderRadius: t.radius.card, backgroundColor: t.colors.successTint }}>
                <Badge tone="success" icon="check-circle">
                  Signature captured
                </Badge>
              </View>
              <Button testID="pod-resign" label="Re-sign" onPress={clearSignature} tone="neutral" variant="outline" size="md" icon="edit-2" disabled={busy !== null} fullWidth />
            </View>
          ) : (
            <View style={{ gap: t.space.sm }}>
              <View testID="pod-signature-pad" style={{ height: SIGNATURE_HEIGHT, borderRadius: t.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.hairline, backgroundColor: '#ffffff' }}>
                <SignatureScreen ref={sigRef} onOK={(sig) => setSignature(sig)} onEmpty={() => toast('Please sign in the box first.', 'warning')} webStyle={signaturePadStyle} backgroundColor="#ffffff" penColor="#0a2540" />
              </View>
              <View style={{ flexDirection: 'row', gap: t.space.md }}>
                <View style={{ flex: 1 }}>
                  <Button testID="pod-clear" label="Clear" onPress={clearSignature} variant="ghost" size="md" icon="x" disabled={busy !== null} fullWidth />
                </View>
                <View style={{ flex: 1 }}>
                  <Button testID="pod-confirm-signature" label="Use signature" onPress={confirmSignature} tone="neutral" variant="outline" size="md" icon="check" disabled={busy !== null} fullWidth />
                </View>
              </View>
            </View>
          )}
        </Card>

        <View style={{ height: t.space.xl }} />

        <Button
          testID="pod-submit"
          label={podCaptured ? 'Complete delivery' : 'Capture proof & complete'}
          icon="check-circle"
          onPress={() => void submit()}
          busy={busy === 'submit'}
          disabled={!ready}
          size="lg"
          haptic="none"
          fullWidth
        />
        {!ready && busy === null ? (
          <Text variant="footnote" color={t.colors.textTertiary} center style={{ marginTop: t.space.sm }}>
            Add a photo and a signature to complete.
          </Text>
        ) : null}

        <View style={{ height: t.space.lg }} />
        <Button label="Back to stop" onPress={() => navigation.goBack()} variant="ghost" size="md" icon="arrow-left" disabled={busy !== null} fullWidth />
      </Screen>
      {toastNode}
    </View>
  );
}
