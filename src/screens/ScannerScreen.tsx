import { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator, 
  FlatList, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform,
  Dimensions,
  Image,
  Keyboard,
  Pressable,
  Modal,
  ScrollView,
  GestureResponderEvent,
  NativeSyntheticEvent,
  NativeTouchEvent,
  RefreshControl
} from 'react-native';
import { Camera, CameraView, useCameraPermissions, type FocusMode } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';
import ImageView from "react-native-image-viewing";
import { useTheme } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');
const MAX_VIDEO_DURATION_SECONDS = 15;

const getTouchDistance = (touches: NativeTouchEvent['touches']) => {
  if (touches.length < 2) return null;
  const [first, second] = touches;
  const dx = first.pageX - second.pageX;
  const dy = first.pageY - second.pageY;
  return Math.sqrt(dx * dx + dy * dy);
};

interface Message {
  id: string | number;
  direction: 'in' | 'out'; // 'in' = PC收到 (Mobile->PC), 'out' = PC发出 (PC->Mobile)
  msg_type: 'text' | 'file' | 'image' | 'video';
  content: string;
  timestamp: number;
  sender_id: string;
  sender_name: string;
  isOptimistic?: boolean; // 乐观UI标记
}

const MEDIA_MESSAGE_TYPES: Message['msg_type'][] = ['image', 'video', 'file'];
const buildCachedImageSource = (uri: string) => ({ uri, cache: 'force-cache' as const });

type CaptureDraft = {
  uri: string;
  kind: 'image' | 'video';
  mimeType: string;
  fileName: string;
};

export default function ScannerScreen() {
  const { colors, isDark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [savedDeviceIp, setSavedDeviceIp] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-1
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [hapticLevel, setHapticLevel] = useState(3);

  // 悬浮菜单状态
  const [menuConfig, setMenuConfig] = useState<{
    visible: boolean;
    x: number;
    y: number;
    anchorX: number;
    menuWidth: number;
    item: Message | null;
  }>({ visible: false, x: 0, y: 0, anchorX: 0, menuWidth: 0, item: null });

  // 图片预览状态
  const [previewImages, setPreviewImages] = useState<Array<{ uri: string; cache?: 'force-cache' }>>([]);
  const [isPreviewVisible, setPreviewVisible] = useState(false);

  // 全屏文本选择状态
  const [fullScreenText, setFullScreenText] = useState('');
  const [isFullScreenVisible, setFullScreenVisible] = useState(false);

  // 视频预览状态
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isCaptureVisible, setCaptureVisible] = useState(false);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState(MAX_VIDEO_DURATION_SECONDS);
  const [captureFacing, setCaptureFacing] = useState<'front' | 'back'>('back');
  const [captureZoom, setCaptureZoom] = useState(0);
  const [captureFlash, setCaptureFlash] = useState<'off' | 'on'>('off');
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft | null>(null);
  const [pendingRecordStart, setPendingRecordStart] = useState(false);
  const [captureAutofocus, setCaptureAutofocus] = useState<FocusMode>('off');
  const [focusIndicator, setFocusIndicator] = useState<{ x: number; y: number; visible: boolean }>({
    x: width / 2,
    y: width / 2,
    visible: false,
  });
  const [isCameraReady, setIsCameraReady] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const captureCameraRef = useRef<CameraView | null>(null);
  const isRecordingRef = useRef(false);

  const previewPlayer = useVideoPlayer(previewVideoUrl || '', (player) => {
    player.play();
  });

  const capturePlayer = useVideoPlayer(captureDraft?.uri || '', (player) => {
    player.loop = true;
    player.play();
  });

  const didLongPressCaptureRef = useRef(false);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);

  useEffect(() => {
    initDevice();
    checkPreviousConnection();
    loadHapticLevel();
    return () => {
      ws.current?.close();
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (recordingStartTimeoutRef.current) {
        clearTimeout(recordingStartTimeoutRef.current);
      }
      if (focusIndicatorTimeoutRef.current) {
        clearTimeout(focusIndicatorTimeoutRef.current);
      }
    };
  }, []);

  const loadHapticLevel = async () => {
    const level = await AsyncStorage.getItem('hapticLevel');
    if (level) setHapticLevel(parseInt(level));
  };

  const triggerUserHaptic = () => {
    if (hapticLevel === 0) return;
    const style = 
      hapticLevel >= 4 ? Haptics.ImpactFeedbackStyle.Heavy :
      hapticLevel >= 2 ? Haptics.ImpactFeedbackStyle.Medium : 
      Haptics.ImpactFeedbackStyle.Light;
    Haptics.impactAsync(style);
  };

  useEffect(() => {
    if (savedDeviceIp) {
      setMessages([]);
      setHasLoadedHistory(false);
      setIsLoadingHistory(false);
      connectWebSocket();
    }
  }, [savedDeviceIp]);

  useEffect(() => {
    if (!savedDeviceIp) return;
    const baseIp = savedDeviceIp.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
    const remoteImageUrls = messages
      .filter((item) => item.msg_type === 'image' && item.content.startsWith('/download') && !item.isOptimistic)
      .map((item) => `${baseIp}${item.content}`);

    remoteImageUrls.forEach((uri) => {
      Image.prefetch(uri).catch(() => {});
    });
  }, [messages, savedDeviceIp]);

  const initDevice = async () => {
    let id = await AsyncStorage.getItem('mobile_device_id');
    if (!id) {
      id = Crypto.randomUUID();
      await AsyncStorage.setItem('mobile_device_id', id);
    }
    setDeviceId(id);
  };

  const fetchHistory = async () => {
    if (!savedDeviceIp) return;
    setIsLoadingHistory(true);
    try {
      const baseIp = savedDeviceIp.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
      const res = await fetch(`${baseIp}/poll?last_id=0`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      }
    } catch (e) {
      console.log('Fetch history failed', e);
    } finally {
      setHasLoadedHistory(true);
      setIsLoadingHistory(false);
    }
  };

  const connectWebSocket = () => {
    if (!savedDeviceIp) return;
    if (ws.current) ws.current.close();
    const rawIp = savedDeviceIp.replace('http://', '').replace('https://', '');
    const wsUrl = `ws://${rawIp}/ws`;
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'identity', device_id: deviceId, device_name: Platform.OS === 'ios' ? 'iPhone' : 'Android Phone'
      }));
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'devices_update') return;
        setMessages(prev => {
          let filtered = prev.filter(m => !(m.isOptimistic && m.content === msg.content));
          if (
            msg.sender_id === deviceId &&
            MEDIA_MESSAGE_TYPES.includes(msg.msg_type) &&
            filtered.some(m => m.isOptimistic)
          ) {
            const optimisticIndex = [...filtered]
              .map((m, index) => ({ m, index }))
              .reverse()
              .find(({ m }) => (
                m.isOptimistic &&
                m.sender_id === msg.sender_id &&
                m.msg_type === msg.msg_type
              ))?.index;

            if (optimisticIndex !== undefined) {
              filtered = filtered.filter((_, index) => index !== optimisticIndex);
            }
          }
          if (filtered.find(m => m.id === msg.id)) return filtered;
          return [...filtered, msg];
        });
      } catch (err) {}
    };
  };

  const checkPreviousConnection = async () => {
    try {
      setIsConnecting(true);
      const ip = await AsyncStorage.getItem('lastDeviceIp');
      if (ip) setSavedDeviceIp(ip);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBarcodeScanned = async ({ data }: any) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsScanning(false);
    setSavedDeviceIp(data);
    await AsyncStorage.setItem('lastDeviceIp', data);
  };

  const clearConnection = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.removeItem('lastDeviceIp');
    setSavedDeviceIp(null);
    setMessages([]);
    setHasLoadedHistory(false);
    setIsLoadingHistory(false);
    ws.current?.close();
  }

  const sendMessage = async () => {
    if (!inputText.trim() || !savedDeviceIp) return;
    const text = inputText.trim();
    setInputText('');
    
    // 乐观UI：立即显示
    const tempId = Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      direction: 'in',
      msg_type: 'text',
      content: text,
      timestamp: tempId,
      sender_id: deviceId,
      sender_name: '手机端',
      isOptimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);
    triggerUserHaptic();

    try {
      const baseIp = savedDeviceIp.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
      await fetch(`${baseIp}/send_text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, sender_id: deviceId, sender_name: '手机端' }),
      });
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      Alert.alert('发送失败', '请检查局域网连接');
    }
  };

  const handlePlusPress = () => {
    Keyboard.dismiss();
    triggerUserHaptic();
    setIsPlusMenuOpen(!isPlusMenuOpen);
  };

  const pickImageAndSend = async () => {
    setIsPlusMenuOpen(false);
    if (!savedDeviceIp) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
      if (result.canceled) return;
      const asset = result.assets[0];
      await performUpload(asset.uri, asset.fileName || 'image.jpg', asset.mimeType || 'image/jpeg');
    } catch (e) { Alert.alert('错误', '无法打开相册'); }
  };

  const resetRecordingState = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setPendingRecordStart(false);
    setRecordSecondsLeft(MAX_VIDEO_DURATION_SECONDS);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (recordingStartTimeoutRef.current) {
      clearTimeout(recordingStartTimeoutRef.current);
      recordingStartTimeoutRef.current = null;
    }
  };

  const clampZoom = (value: number) => Math.max(0, Math.min(1, value));
  const updateCaptureZoom = (value: number) => setCaptureZoom(clampZoom(value));

  const openCaptureCamera = async () => {
    setIsPlusMenuOpen(false);
    if (!savedDeviceIp) return;
    const { granted } = permission ?? await requestPermission();
    if (!granted) {
      Alert.alert('权限不足', '需要相机权限');
      return;
    }

    setCaptureFlash('off');
    setCaptureZoom(0);
    setCaptureAutofocus('off');
    setCaptureDraft(null);
    setCaptureVisible(true);
  };

  const closeCaptureCamera = () => {
    if (isRecordingRef.current) {
      captureCameraRef.current?.stopRecording();
    }
    resetRecordingState();
    setCaptureVisible(false);
    setCaptureDraft(null);
    setCaptureAutofocus('off');
    setFocusIndicator((prev) => ({ ...prev, visible: false }));
    pinchStartDistanceRef.current = null;
  };

  const toggleCaptureFacing = () => {
    if (isRecordingRef.current) return;
    setCaptureFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  const toggleCaptureFlash = () => {
    if (captureFacing === 'front') return;
    setCaptureFlash((prev) => (prev === 'on' ? 'off' : 'on'));
  };

  const handleCaptureTouchStart = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const distance = getTouchDistance(event.nativeEvent.touches);
    if (distance == null) return;
    pinchStartDistanceRef.current = distance;
    pinchStartZoomRef.current = captureZoom;
  };

  const handleCaptureTouchMove = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const startDistance = pinchStartDistanceRef.current;
    const currentDistance = getTouchDistance(event.nativeEvent.touches);
    if (startDistance == null || currentDistance == null) return;
    const delta = (currentDistance - startDistance) / 240;
    updateCaptureZoom(pinchStartZoomRef.current + delta);
  };

  const handleCaptureTouchEnd = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (event.nativeEvent.touches.length < 2) {
      pinchStartDistanceRef.current = null;
      pinchStartZoomRef.current = captureZoom;
    }
  };

  const handleFocusTap = (event: GestureResponderEvent) => {
    if (captureDraft || isRecordingRef.current) return;
    const { locationX, locationY } = event.nativeEvent;

    setFocusIndicator({
      x: locationX,
      y: locationY,
      visible: true,
    });
    setCaptureAutofocus('on');

    if (focusIndicatorTimeoutRef.current) {
      clearTimeout(focusIndicatorTimeoutRef.current);
    }

    focusIndicatorTimeoutRef.current = setTimeout(() => {
      setFocusIndicator((prev) => ({ ...prev, visible: false }));
      setCaptureAutofocus('off');
    }, 900);
  };

  const handleTakePhoto = async () => {
    if (!savedDeviceIp || isRecordingRef.current || !captureCameraRef.current) return;

    try {
      const photo = await captureCameraRef.current.takePictureAsync({
        quality: 0.8,
        shutterSound: false,
      });
      if (!photo?.uri) return;
      setCaptureDraft({
        uri: photo.uri,
        kind: 'image',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
      });
    } catch (e) {
      Alert.alert('拍照失败', '请稍后重试');
    }
  };

  const stopRecordingIfNeeded = () => {
    if (!isRecordingRef.current) return;
    captureCameraRef.current?.stopRecording();
  };

  const beginRecordingSession = async () => {
    if (!savedDeviceIp || isRecordingRef.current || !captureCameraRef.current || !pendingRecordStart) return;

    setPendingRecordStart(false);
    setIsRecording(true);
    setRecordSecondsLeft(MAX_VIDEO_DURATION_SECONDS);
    isRecordingRef.current = true;

    recordingIntervalRef.current = setInterval(() => {
      setRecordSecondsLeft((prev) => {
        if (prev <= 1) {
          stopRecordingIfNeeded();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      const video = await captureCameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_SECONDS,
      });

      resetRecordingState();

      if (video?.uri) {
        setCaptureDraft({
          uri: video.uri,
          kind: 'video',
          mimeType: 'video/mp4',
          fileName: 'video.mp4',
        });
      }
    } catch (e) {
      resetRecordingState();
      const message = e instanceof Error ? e.message : '请稍后重试';
      Alert.alert('录像失败', message);
    }
  };

  useEffect(() => {
    if (!pendingRecordStart || !isCaptureVisible || captureDraft) return;

    recordingStartTimeoutRef.current = setTimeout(() => {
      beginRecordingSession();
    }, 200);

    return () => {
      if (recordingStartTimeoutRef.current) {
        clearTimeout(recordingStartTimeoutRef.current);
        recordingStartTimeoutRef.current = null;
      }
    };
  }, [pendingRecordStart, isCaptureVisible, captureDraft]);

  const handleStartRecording = async () => {
    if (!savedDeviceIp || isRecordingRef.current || pendingRecordStart || !captureCameraRef.current) return;

    didLongPressCaptureRef.current = true;
    const micPermission = await Camera.requestMicrophonePermissionsAsync();
    if (!micPermission.granted) {
      Alert.alert('权限不足', '录制视频需要麦克风权限');
      didLongPressCaptureRef.current = false;
      return;
    }

    setRecordSecondsLeft(MAX_VIDEO_DURATION_SECONDS);
    setPendingRecordStart(true);
  };

  const handleCapturePressOut = (_event?: GestureResponderEvent) => {
    if (pendingRecordStart && !isRecordingRef.current) {
      setPendingRecordStart(false);
      didLongPressCaptureRef.current = false;
      return;
    }
    if (isRecordingRef.current) {
      stopRecordingIfNeeded();
    }
  };

  const cancelCaptureDraft = () => {
    setCaptureDraft(null);
    setCaptureZoom(0);
  };

  const confirmCaptureDraft = async () => {
    if (!captureDraft) return;
    const draft = captureDraft;
    setCaptureDraft(null);
    setCaptureVisible(false);
    await performUpload(draft.uri, draft.fileName, draft.mimeType);
  };

  const pickAndSendFile = async () => {
    setIsPlusMenuOpen(false);
    if (!savedDeviceIp) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      await performUpload(file.uri, file.name, file.mimeType || 'application/octet-stream');
    } catch (e) { Alert.alert('发送异常', '文件读取失败'); }
  };

  const performUpload = async (uri: string, name: string, mimeType: string) => {
    setIsUploading(true);
    setUploadProgress(0.12);
    
    // 乐观 UI: 立即显示文件/图片占位
    const tempId = Date.now();
    const isImage = mimeType.startsWith('image');
    const isVideo = mimeType.startsWith('video');
    const optimisticMsg: Message = {
      id: tempId,
      direction: 'in',
      msg_type: isImage ? 'image' : (isVideo ? 'video' : 'file'),
      content: (isImage || isVideo) ? uri : name,
      timestamp: tempId,
      sender_id: deviceId,
      sender_name: '手机端',
      isOptimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const baseIp = savedDeviceIp!.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
      const uploadUrl = `${baseIp}/upload`;
      const formData = new FormData();
      formData.append('sender_id', deviceId);
      formData.append('sender_name', '手机端');
      formData.append('file', {
        uri,
        name,
        type: mimeType,
      } as any);

      setUploadProgress(0.55);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setUploadProgress(1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `Upload failed with status ${response.status}`);
      }
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      const message = e instanceof Error ? e.message : '未知错误';
      Alert.alert('上传失败', `无法发送文件，请检查电脑端连接状态。\n${message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (hapticLevel > 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDownload = async (item: Message) => {
    const baseIp = savedDeviceIp?.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
    const fileUrl = `${baseIp}${item.content}`;
    const fileName = item.content.split('name=').pop() || 'downloaded_file';
    const decodedName = decodeURIComponent(fileName);

    try {
      if (hapticLevel > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const downloadRes = await LegacyFileSystem.downloadAsync(
        fileUrl,
        `${LegacyFileSystem.documentDirectory ?? ''}${decodedName}`
      );

      if (item.msg_type === 'image') {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(downloadRes.uri);
          Alert.alert('已存入相册', `图片 ${decodedName} 已存入系统相册`);
        }
      } else {
        await Sharing.shareAsync(downloadRes.uri);
      }
    } catch (e) {
      Alert.alert('下载失败', '无法拉取外部文件');
    }
  };

  const showMenu = (event: any, item: Message) => {
    if (hapticLevel > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const { pageX, pageY } = event.nativeEvent;
    
    // 动态计算菜单宽度（按钮数量不同）
    const menuWidth = item.msg_type === 'text' ? 140 : 180;
    
    setMenuConfig({
      visible: true,
      x: Math.min(width - menuWidth - 16, Math.max(16, pageX - menuWidth / 2)),
      y: pageY - 90, // 稍微靠近手指，看起来更有连接感
      anchorX: pageX,
      menuWidth,
      item: item
    });
  };

  const closeMenu = () => setMenuConfig(prev => ({ ...prev, visible: false }));

  const styles = getStyles(colors, isDark);

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isMe = item.direction === 'in'; 
    const isRemoteMedia = (item.msg_type === 'image' || item.msg_type === 'video') && item.content.startsWith('/download');
    const baseIp = savedDeviceIp?.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
    const mediaUrl = isRemoteMedia ? `${baseIp}${item.content}` : (isMe && (item.msg_type === 'image' || item.msg_type === 'video') ? item.content : null);
    const showUploadBadge = item.isOptimistic && isUploading;
    const uploadPercent = Math.max(1, Math.min(99, Math.round(uploadProgress * 100)));

    return (
      <View style={[styles.messageRow, isMe ? styles.myRow : styles.otherRow]}>
        <Pressable 
          onLongPress={(e) => showMenu(e, item)}
          onPress={() => {
            if (!item.isOptimistic && item.msg_type === 'image' && mediaUrl) {
              setPreviewImages([buildCachedImageSource(mediaUrl)]);
              setPreviewVisible(true);
            }
          }}
          style={({pressed}) => [
            styles.bubble, 
            isMe ? styles.myBubble : styles.otherBubble,
            ((item.msg_type === 'image' || item.msg_type === 'video') && mediaUrl) && { 
              padding: 0, 
              borderRadius: 16, 
              backgroundColor: 'transparent',
              borderWidth: 0,
              shadowOpacity: 0
            },
            pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
            item.isOptimistic && { opacity: 0.6 }
          ]}
        >
          {item.msg_type === 'text' && (
            <Text 
              style={isMe ? styles.myText : styles.otherText}
            >
              {item.content}
            </Text>
          )}

          {item.msg_type === 'image' && mediaUrl && (
            <View>
              <AutoHeightImage uri={mediaUrl} maxWidth={width * 0.6} />
              {showUploadBadge && (
                <View style={styles.uploadBadge}>
                  <Text style={styles.uploadBadgeText}>{uploadPercent}</Text>
                </View>
              )}
            </View>
          )}

          {item.msg_type === 'video' && mediaUrl && (
            <Pressable 
              onPress={() => {
                if (!item.isOptimistic) setPreviewVideoUrl(mediaUrl);
              }}
              style={styles.videoContainer}
            >
              <VideoThumbnailView uri={mediaUrl} styles={styles} />
              <View style={styles.videoPlayOverlay}>
                <Feather name="play" size={24} color="#FFF" />
              </View>
              {showUploadBadge && (
                <View style={styles.uploadBadge}>
                  <Text style={styles.uploadBadgeText}>{uploadPercent}</Text>
                </View>
              )}
            </Pressable>
          )}

          {(item.msg_type === 'file' || (item.msg_type === 'image' && !mediaUrl) || (item.msg_type === 'video' && !mediaUrl)) && (
            <View style={styles.fileContainer}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Feather name={item.msg_type === 'image' ? 'image' : (item.msg_type === 'video' ? 'video' : 'file')} size={20} color={isMe ? colors.primaryText : colors.text} />
                  <Text style={[styles.fileName, isMe ? styles.myText : styles.otherText]} numberOfLines={1}>
                    {item.msg_type === 'image' ? '图片文件' : (item.msg_type === 'video' ? '视频文件' : item.content.split('/').pop()?.split('?')[0])}
                  </Text>
                </View>
                {showUploadBadge && (
                  <View style={styles.fileFooterRow}>
                    <View style={[styles.uploadBadge, styles.uploadBadgeInline]}>
                      <Text style={styles.uploadBadgeText}>{uploadPercent}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}
        </Pressable>
      </View>
    );
  };

  if (isConnecting) return <View style={styles.container}><ActivityIndicator size="large" color={colors.text} /></View>;

  if (savedDeviceIp && !isScanning) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 50 : 20 }]}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={clearConnection} style={styles.iconBtn}><Feather name="chevron-left" size={24} color={colors.text} /></TouchableOpacity>
          <Text style={styles.headerTitle}>文件传输</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ flex: 1, paddingBottom: 85 }}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderMessageItem}
            contentContainerStyle={[
              styles.listContent,
              messages.length === 0 && styles.emptyListContent
            ]}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
            refreshControl={
              <RefreshControl
                refreshing={isLoadingHistory}
                onRefresh={fetchHistory}
                tintColor={colors.text}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyHistoryBox}>
                <Feather name="inbox" size={34} color={colors.subText} />
                <Text style={styles.emptyHistoryTitle}>
                  {hasLoadedHistory ? '还没有历史记录' : '页面已保持空白'}
                </Text>
                <Text style={styles.emptyHistoryDesc}>
                  {hasLoadedHistory
                    ? '当前没有可显示的历史消息'
                    : '下拉即可主动加载之前的文件传输记录'}
                </Text>
              </View>
            }
          />

          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
            keyboardVerticalOffset={Platform.OS === 'ios' ? 115 : 0}
          >
            <View style={styles.inputBar}>
              <TouchableOpacity style={styles.plusBtn} onPress={handlePlusPress} disabled={isUploading}>
                {isUploading ? <ActivityIndicator size="small" color={colors.text} /> : <Feather name="plus" size={24} color={colors.text} />}
              </TouchableOpacity>
              <TextInput
                style={styles.input} placeholder="输入内容..." placeholderTextColor={colors.subText}
                value={inputText} onChangeText={setInputText} multiline onFocus={() => setIsPlusMenuOpen(false)}
              />
              <TouchableOpacity style={[styles.sendBtn, { opacity: inputText.trim().length > 0 ? 1 : 0.4 }]} onPress={sendMessage} disabled={inputText.trim().length === 0}>
                <Feather name="send" size={20} color={colors.primaryText} />
              </TouchableOpacity>
            </View>

            {isPlusMenuOpen && (
              <View style={styles.accessoryBar}>
                <ActionItem styles={styles} icon="image" label="照片" color="#007AFF" onPress={pickImageAndSend} />
                <ActionItem 
                  styles={styles}
                  icon="camera" 
                  label="拍摄" 
                  color="#34C759" 
                  onPress={openCaptureCamera}
                />
                <ActionItem styles={styles} icon="file" label="文件" color="#FF9500" onPress={pickAndSendFile} />
              </View>
            )}
          </KeyboardAvoidingView>
        </View>

        <ImageView images={previewImages} imageIndex={0} visible={isPreviewVisible} onRequestClose={() => setPreviewVisible(false)} />

        <Modal visible={isCaptureVisible} animationType="slide" transparent={false}>
          <View
            style={styles.captureContainer}
            onTouchStart={handleCaptureTouchStart}
            onTouchMove={handleCaptureTouchMove}
            onTouchEnd={handleCaptureTouchEnd}
            onTouchCancel={handleCaptureTouchEnd}
          >
            {!captureDraft ? (
              <>
                <CameraView
                  ref={captureCameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={captureFacing}
                  mode="video"
                  zoom={captureZoom}
                  mirror={captureFacing === 'front'}
                  flash={captureFlash}
                  enableTorch={captureFlash === 'on'}
                  autofocus={captureAutofocus}
                  onCameraReady={() => {
                    setIsCameraReady(true);
                  }}
                />
                <Pressable style={StyleSheet.absoluteFill} onPress={handleFocusTap}>
                  {focusIndicator.visible && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.focusIndicator,
                        {
                          left: focusIndicator.x - 34,
                          top: focusIndicator.y - 34,
                        },
                      ]}
                    />
                  )}
                </Pressable>
              </>
            ) : captureDraft.kind === 'image' ? (
              <Image source={{ uri: captureDraft.uri }} style={styles.capturePreviewMedia} resizeMode="contain" />
            ) : (
              <VideoView
                player={capturePlayer}
                style={styles.capturePreviewMedia}
                contentFit="contain"
                allowsFullscreen
                allowsPictureInPicture
              />
            )}

            <View style={styles.captureTopBar}>
              <TouchableOpacity style={styles.captureCloseBtn} onPress={captureDraft ? cancelCaptureDraft : closeCaptureCamera}>
                <Feather name="x" size={26} color="#FFF" />
              </TouchableOpacity>
              {isRecording && !captureDraft && (
                <View style={styles.recordingBadge}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingBadgeText}>{recordSecondsLeft}s</Text>
                </View>
              )}
            </View>

            <View style={styles.captureBottomBar}>
              {!captureDraft ? (
                <>
                  <Text style={styles.captureHint}>
                    {isRecording ? '松开结束录像' : '轻点拍照，长按录像'}
                  </Text>
                  <View style={styles.captureActionRow}>
                    <TouchableOpacity
                      style={[styles.captureSideBtn, captureFacing === 'front' && styles.captureSideBtnDisabled]}
                      onPress={toggleCaptureFlash}
                      disabled={captureFacing === 'front'}
                    >
                      <Feather
                        name={captureFlash === 'on' ? 'zap' : 'zap-off'}
                        size={20}
                        color={captureFacing === 'front' ? 'rgba(255,255,255,0.35)' : '#FFF'}
                      />
                    </TouchableOpacity>
                    <Pressable
                      onPress={() => {
                        if (didLongPressCaptureRef.current) {
                          didLongPressCaptureRef.current = false;
                          return;
                        }
                        handleTakePhoto();
                      }}
                      onLongPress={handleStartRecording}
                      onPressOut={handleCapturePressOut}
                      delayLongPress={220}
                      style={({ pressed }) => [
                        styles.captureButtonOuter,
                        pressed && !isRecording && { transform: [{ scale: 0.96 }] },
                      ]}
                    >
                      <View style={[styles.captureButtonInner, isRecording && styles.captureButtonRecording]} />
                    </Pressable>
                    <TouchableOpacity style={styles.captureSideBtn} onPress={toggleCaptureFacing} disabled={isRecording}>
                      <Feather name="refresh-cw" size={20} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.captureSubHint}>
                    双指缩放，录像最长 {MAX_VIDEO_DURATION_SECONDS} 秒
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.captureHint}>
                    {captureDraft.kind === 'image' ? '确认发送这张照片' : '确认发送这段视频'}
                  </Text>
                  <View style={styles.captureConfirmRow}>
                    <TouchableOpacity style={[styles.captureConfirmBtn, styles.captureCancelBtn]} onPress={cancelCaptureDraft}>
                      <Text style={[styles.captureConfirmText, styles.captureCancelText]}>取消</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.captureConfirmBtn, styles.captureSubmitBtn]} onPress={confirmCaptureDraft}>
                      <Text style={[styles.captureConfirmText, styles.captureSubmitText]}>确定</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* 视频播放弹窗 */}
        <Modal visible={!!previewVideoUrl} animationType="fade" transparent={false}>
          <View style={styles.videoModalContainer}>
            <TouchableOpacity style={styles.videoModalClose} onPress={() => setPreviewVideoUrl(null)}>
              <Feather name="x" size={30} color="#FFF" />
            </TouchableOpacity>
            {previewVideoUrl && (
              <VideoView
                player={previewPlayer}
                style={styles.fullVideo}
                allowsFullscreen
                allowsPictureInPicture
                contentFit="contain"
              />
            )}
          </View>
        </Modal>

        {/* 微信风格长按悬浮菜单 */}
        {menuConfig.visible && (
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu}>
            <View style={[styles.floatingMenu, { top: menuConfig.y, left: menuConfig.x }]}>
              <TouchableOpacity onPress={() => { copyToClipboard(menuConfig.item!.content); closeMenu(); }} style={styles.menuItem}>
                <Feather name="copy" size={18} color="#FFF" />
                <Text style={styles.menuItemText}>复制</Text>
              </TouchableOpacity>
              
              {menuConfig.item?.msg_type === 'text' && (
                <TouchableOpacity onPress={() => { setFullScreenText(menuConfig.item!.content); setFullScreenVisible(true); closeMenu(); }} style={styles.menuItem}>
                  <Feather name="maximize-2" size={18} color="#FFF" />
                  <Text style={styles.menuItemText}>全选</Text>
                </TouchableOpacity>
              )}

              {menuConfig.item?.msg_type !== 'text' && (
                <TouchableOpacity onPress={() => { handleDownload(menuConfig.item!); closeMenu(); }} style={styles.menuItem}>
                  <Feather name="download" size={18} color="#FFF" />
                  <Text style={styles.menuItemText}>下载</Text>
                </TouchableOpacity>
              )}
              <View
                style={[
                  styles.menuArrow,
                  {
                    left: Math.max(
                      20,
                      Math.min(menuConfig.menuWidth - 20, menuConfig.anchorX - menuConfig.x)
                    ),
                  },
                ]}
              />
            </View>
          </Pressable>
        )}

        {/* 全屏文本选择模式 */}
        <Modal visible={isFullScreenVisible} animationType="fade" transparent={false}>
          <View style={styles.fullScreenContent}>
            <View style={styles.fullScreenHeader}>
              <TouchableOpacity onPress={() => setFullScreenVisible(false)}>
                <Feather name="x" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.fullScreenTitle}>文本预览</Text>
              <TouchableOpacity onPress={() => { copyToClipboard(fullScreenText); setFullScreenVisible(false); }}>
                <Text style={{ color: '#007AFF', fontWeight: 'bold' }}>完成</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <TextInput 
                multiline 
                editable={false} 
                style={styles.fullScreenInput}
                value={fullScreenText}
                scrollEnabled={false}
              />
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  if (isScanning) {
    return (
      <View style={styles.container}>
        <CameraView 
          style={StyleSheet.absoluteFillObject} 
          onBarcodeScanned={handleBarcodeScanned} 
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }} 
        />
        
        {/* 全透明层，仅保留框和文字 */}
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={styles.scanBox}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <Text style={styles.scanTip}>对准电脑端二维码</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsScanning(false)}>
            <Text style={styles.cancelBtnText}>取消扫码</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const startScanning = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('需要相机权限', '请在系统设置中允许 TieZ 访问您的相机以扫描二维码');
        return;
      }
    }
    setIsScanning(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.promptBox}>
        <View style={styles.heroIconBox}>
          <Feather name="share-2" size={40} color={colors.text} />
        </View>
        <Text style={styles.promptTitle}>局域网速传</Text>
        
        <View style={styles.instructionList}>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}><Text style={styles.instructionNumberText}>1</Text></View>
            <Text style={styles.instructionText}>电脑端打开 TIEZ</Text>
          </View>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}><Text style={styles.instructionNumberText}>2</Text></View>
            <Text style={styles.instructionText}>在 TIEZ 设置项打开“局域网文件传输”</Text>
          </View>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}><Text style={styles.instructionNumberText}>3</Text></View>
            <Text style={styles.instructionText}>确保手机和 PC 在同一局域网下</Text>
          </View>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}><Text style={styles.instructionNumberText}>4</Text></View>
            <Text style={styles.instructionText}>点击“立即扫码”即可畅传文件</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.mainActionBtn} onPress={startScanning}>
          <Feather name="maximize" size={20} color={colors.primaryText} style={{ marginRight: 8 }} />
          <Text style={styles.mainActionText}>立即扫码</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function VideoThumbnailView({ uri, styles }: { uri: string; styles: any }) {
  const { colors } = useTheme();
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, { time: 0 });
        setThumb(thumbUri);
      } catch (e) {}
    })();
  }, [uri]);

  return (
    <View style={styles.videoThumbBox}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.videoThumb} />
      ) : (
        <View style={[styles.videoThumb, { backgroundColor: colors.card }]} />
      )}
    </View>
  );
}

function AutoHeightImage({ uri, maxWidth }: { uri: string; maxWidth: number }) {
  const [aspectRatio, setAspectRatio] = useState<number>(1);

  useEffect(() => {
    Image.prefetch(uri).catch(() => {});
    Image.getSize(uri, (w, h) => {
      if (w > 0 && h > 0) {
        setAspectRatio(w / h);
      }
    });
  }, [uri]);

  return (
    <Image 
      source={buildCachedImageSource(uri)} 
      style={{ 
        width: maxWidth, 
        height: undefined, 
        aspectRatio, 
        borderRadius: 12 
      }} 
      resizeMode="cover" 
    />
  );
}

function ActionItem({ icon, label, color, onPress, onLongPress, styles }: any) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity 
      style={styles.accessoryItem} 
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    >
      <View style={[styles.accessoryIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={24} color="#FFF" />
      </View>
      <Text style={[styles.accessoryText, { color: colors.subText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  promptBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  captureContainer: { flex: 1, backgroundColor: '#000' },
  capturePreviewMedia: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000'
  },
  focusIndicator: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FDE68A',
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  captureTopBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    left: 20,
    right: 20,
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  captureCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? 40 : 24,
    alignItems: 'center'
  },
  captureHint: { color: '#FFF', fontSize: 15, fontWeight: '600', marginBottom: 18 },
  captureSubHint: { color: 'rgba(255,255,255,0.72)', fontSize: 13, marginTop: 14 },
  captureActionRow: {
    width: '100%',
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  captureConfirmRow: {
    width: '100%',
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  captureConfirmBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureCancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.28)'
  },
  captureSubmitBtn: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E'
  },
  captureConfirmText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700'
  },
  captureCancelText: {
    color: '#FFF'
  },
  captureSubmitText: {
    color: '#08130A'
  },
  captureSideBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.34)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureSideBtnDisabled: {
    backgroundColor: 'rgba(0,0,0,0.2)'
  },
  captureButtonOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.88)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureButtonInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFF'
  },
  captureButtonRecording: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FF3B30'
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.35)'
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    marginRight: 8
  },
  recordingBadgeText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700'
  },
  heroIconBox: { width: 80, height: 80, borderRadius: 24, backgroundColor: colors.card, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  promptTitle: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 24 },
  instructionList: { width: '100%', marginBottom: 44, paddingHorizontal: 10 },
  instructionItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  instructionNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  instructionNumberText: { color: colors.primaryText, fontSize: 13, fontWeight: '800' },
  instructionText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  mainActionBtn: { backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 16 },
  mainActionText: { color: colors.primaryText, fontSize: 17, fontWeight: '600' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 32 },
  emptyListContent: { flexGrow: 1, justifyContent: 'center' },
  emptyHistoryBox: { alignItems: 'center', paddingHorizontal: 32 },
  emptyHistoryTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptyHistoryDesc: { color: colors.subText, fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  messageRow: { marginBottom: 16, flexDirection: 'row', width: '100%' },
  myRow: { justifyContent: 'flex-end' },
  otherRow: { justifyContent: 'flex-start' },
  bubble: { 
    maxWidth: width * 0.75, 
    borderRadius: 20, 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  myBubble: { 
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  otherBubble: { 
    backgroundColor: colors.card,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  myText: { color: colors.primaryText, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  otherText: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  fileContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fileName: { marginLeft: 8, fontSize: 14, flexShrink: 1 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, paddingBottom: Platform.OS === 'ios' ? 12 : 12, backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  input: { flex: 1, backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.text, fontSize: 16, maxHeight: 100, marginHorizontal: 10 },
  plusBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, justifyContent: 'center', alignItems: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: colors.background
  },
  accessoryItem: { flex: 1, alignItems: 'center' },
  accessoryIcon: { width: 60, height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  accessoryText: { fontSize: 13 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },

  floatingMenu: {
    position: 'absolute',
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    flexDirection: 'row',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 9999
  },
  menuItem: { alignItems: 'center', paddingHorizontal: 12 },
  menuItemText: { color: '#FFF', fontSize: 12, marginTop: 4 },
  menuArrow: {
    position: 'absolute',
    bottom: -8,
    left: '50%',
    marginLeft: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderLeftColor: 'transparent',
    borderRightWidth: 8,
    borderRightColor: 'transparent',
    borderTopWidth: 8,
    borderTopColor: '#2C2C2E',
  },

  blurBtnBg: { 
    width: 50, height: 50, borderRadius: 25, 
    backgroundColor: 'rgba(255,255,255,0.2)', 
    justifyContent: 'center', alignItems: 'center' 
  },

  fullScreenContent: { flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'ios' ? 50 : 20 },
  fullScreenHeader: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider 
  },
  fullScreenTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  fullScreenInput: { color: colors.text, fontSize: 18, lineHeight: 28, textAlignVertical: 'top' },

  uploadBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  uploadBadgeInline: {
    position: 'relative',
    right: 0,
    bottom: 0,
    width: 30,
    height: 30,
    borderRadius: 15
  },
  uploadBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700'
  },
  fileFooterRow: {
    marginTop: 8,
    alignItems: 'flex-end'
  },

  videoContainer: { width: width * 0.5, aspectRatio: 16/9, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card },
  videoThumbBox: { ...StyleSheet.absoluteFillObject },
  videoThumb: { width: '100%', height: '100%' },
  videoPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  
  fullVideo: { width: '100%', height: '100%' },
  videoModalContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  videoModalClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    right: 20,
    zIndex: 1,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center'
  },

  scanBox: { width: 260, height: 260, position: 'relative', marginBottom: 40 },
  corner: { width: 40, height: 40, position: 'absolute', borderColor: '#FFF', borderWidth: 4 },
  topLeft: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 24 },
  topRight: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 24 },
  bottomLeft: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 24 },
  bottomRight: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 24 },
  scanTip: { color: '#FFF', fontSize: 16, marginBottom: 60, fontWeight: '500', textAlign: 'center' },
  cancelBtn: { padding: 12 },
  cancelBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' }
});
