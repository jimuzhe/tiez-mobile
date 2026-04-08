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
  ScrollView
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Video, ResizeMode } from 'expo-av';
import ImageView from "react-native-image-viewing";

const { width } = Dimensions.get('window');

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

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [savedDeviceIp, setSavedDeviceIp] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-1
  const [deviceId, setDeviceId] = useState('');
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [hapticLevel, setHapticLevel] = useState(3);

  // 悬浮菜单状态
  const [menuConfig, setMenuConfig] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: Message | null;
  }>({ visible: false, x: 0, y: 0, item: null });

  // 图片预览状态
  const [previewImages, setPreviewImages] = useState<{uri: string}[]>([]);
  const [isPreviewVisible, setPreviewVisible] = useState(false);

  // 全屏文本选择状态
  const [fullScreenText, setFullScreenText] = useState('');
  const [isFullScreenVisible, setFullScreenVisible] = useState(false);

  // 视频预览状态
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    initDevice();
    checkPreviousConnection();
    loadHapticLevel();
    return () => ws.current?.close();
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
      connectWebSocket();
      fetchHistory();
    }
  }, [savedDeviceIp]);

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
    try {
      const baseIp = savedDeviceIp.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
      const res = await fetch(`${baseIp}/poll?last_id=0`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      }
    } catch (e) {
      console.log('Fetch history failed', e);
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
          // 移除同内容的乐观消息
          const filtered = prev.filter(m => !(m.isOptimistic && m.content === msg.content));
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

  const takePhotoAndSend = async (recordVideo = false) => {
    setIsPlusMenuOpen(false);
    if (!savedDeviceIp) return;
    try {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return Alert.alert('权限不足', '需要相机权限');
      
      const result = await ImagePicker.launchCameraAsync({ 
        quality: 0.8,
        mediaTypes: recordVideo ? ['videos'] : ['images']
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      const name = recordVideo ? 'video.mp4' : 'photo.jpg';
      const type = recordVideo ? 'video/mp4' : 'image/jpeg';
      await performUpload(asset.uri, asset.fileName || name, asset.mimeType || type);
    } catch (e) { Alert.alert('错误', '无法打开相机'); }
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
    setUploadProgress(0);
    
    // 乐观 UI: 立即显示文件/图片占位
    const tempId = Date.now();
    const isImage = mimeType.startsWith('image');
    const optimisticMsg: Message = {
      id: tempId,
      direction: 'in',
      msg_type: isImage ? 'image' : 'file',
      content: isImage ? uri : name,
      timestamp: tempId,
      sender_id: deviceId,
      sender_name: '手机端',
      isOptimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const baseIp = savedDeviceIp!.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
      const uploadUrl = `${baseIp}/upload`;

      const task = FileSystem.createUploadTask(
        uploadUrl,
        uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          parameters: {
            sender_id: deviceId,
            sender_name: '手机端',
          },
        },
        (progress) => {
          const p = progress.totalBytesSent / progress.totalBytesExpectedToSend;
          setUploadProgress(p);
          // 这里可以考虑更新 messages 里的乐观消息进度，但为了性能暂时只用全局状态
        }
      );

      const response = await task.uploadAsync();

      if (response && response.status === 200) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      Alert.alert('上传失败', '连接已断开或文件过大');
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
      const downloadRes = await FileSystem.downloadAsync(
        fileUrl,
        FileSystem.documentDirectory + decodedName
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
    
    // 稍微向上偏移，防止挡住手指，且尽量避开可能的系统放大镜
    setMenuConfig({
      visible: true,
      x: Math.min(width - 180, Math.max(16, pageX - 90)),
      y: pageY - 120,
      item: item
    });
  };

  const closeMenu = () => setMenuConfig(prev => ({ ...prev, visible: false }));

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isMe = item.direction === 'in'; 
    const isPCImage = item.msg_type === 'image' && item.content.startsWith('/download');
    const baseIp = savedDeviceIp?.startsWith('http') ? savedDeviceIp : `http://${savedDeviceIp}`;
    const imageUrl = isPCImage ? `${baseIp}${item.content}` : (isMe && item.msg_type === 'image' ? item.content : null);

    return (
      <View style={[styles.messageRow, isMe ? styles.myRow : styles.otherRow]}>
        <Pressable 
          onLongPress={(e) => showMenu(e, item)}
          onPress={() => {
            if (item.msg_type === 'image' && imageUrl) {
              setPreviewImages([{ uri: imageUrl }]);
              setPreviewVisible(true);
            }
          }}
          style={({pressed}) => [
            styles.bubble, 
            isMe ? styles.myBubble : styles.otherBubble,
            (item.msg_type === 'image' && imageUrl) && { padding: 0, borderRadius: 12, backgroundColor: 'transparent' },
            pressed && { opacity: 0.8 },
            item.isOptimistic && { opacity: 0.5 }
          ]}
        >
          {item.msg_type === 'text' && (
            <Text 
              style={isMe ? styles.myText : styles.otherText}
            >
              {item.content}
            </Text>
          )}

          {item.msg_type === 'image' && imageUrl && (
            <View style={item.isOptimistic && { opacity: 0.7 }}>
              <AutoHeightImage uri={imageUrl} maxWidth={width * 0.6} />
              {item.isOptimistic && isUploading && (
                <View style={styles.uploadProgressOverlay}>
                  <View style={[styles.progressBar, { width: `${uploadProgress * 100}%` }]} />
                </View>
              )}
            </View>
          )}

          {item.msg_type === 'video' && imageUrl && (
            <Pressable 
              onPress={() => setPreviewVideoUrl(imageUrl)}
              style={[styles.videoContainer, item.isOptimistic && { opacity: 0.7 }]}
            >
              <VideoThumbnailView uri={imageUrl} />
              <View style={styles.videoPlayOverlay}>
                <Feather name="play" size={24} color="#FFF" />
              </View>
              {item.isOptimistic && isUploading && (
                <View style={styles.uploadProgressOverlay}>
                  <View style={[styles.progressBar, { width: `${uploadProgress * 100}%` }]} />
                </View>
              )}
            </Pressable>
          )}

          {(item.msg_type === 'file' || (item.msg_type === 'image' && !imageUrl) || (item.msg_type === 'video' && !imageUrl)) && (
            <View style={styles.fileContainer}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Feather name={item.msg_type === 'image' ? 'image' : (item.msg_type === 'video' ? 'video' : 'file')} size={20} color={isMe ? '#000' : '#FFF'} />
                  <Text style={[styles.fileName, isMe ? styles.myText : styles.otherText]} numberOfLines={1}>
                    {item.msg_type === 'image' ? '图片文件' : (item.msg_type === 'video' ? '视频文件' : item.content.split('/').pop()?.split('?')[0])}
                  </Text>
                </View>
                {item.isOptimistic && isUploading && (
                  <View style={[styles.fileProgressBarContainer, { backgroundColor: isMe ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)' }]}>
                    <View style={[styles.fileProgressBar, { width: `${uploadProgress * 100}%`, backgroundColor: isMe ? '#000' : '#FFF' }]} />
                  </View>
                )}
              </View>
            </View>
          )}
        </Pressable>
      </View>
    );
  };

  if (isConnecting) return <View style={styles.container}><ActivityIndicator size="large" color="#FFF" /></View>;

  if (savedDeviceIp && !isScanning) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 50 : 20 }]}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={clearConnection} style={styles.iconBtn}><Feather name="chevron-left" size={24} color="#FFF" /></TouchableOpacity>
          <Text style={styles.headerTitle}>文件传输</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={{ flex: 1, paddingBottom: 85 }}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
          />

          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
            keyboardVerticalOffset={Platform.OS === 'ios' ? 115 : 0}
          >
            <View style={styles.inputBar}>
              <TouchableOpacity style={styles.plusBtn} onPress={handlePlusPress} disabled={isUploading}>
                {isUploading ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="plus" size={24} color="#FFF" />}
              </TouchableOpacity>
              <TextInput
                style={styles.input} placeholder="输入内容..." placeholderTextColor="#666"
                value={inputText} onChangeText={setInputText} multiline onFocus={() => setIsPlusMenuOpen(false)}
              />
              <TouchableOpacity style={[styles.sendBtn, { opacity: inputText.trim().length > 0 ? 1 : 0.4 }]} onPress={sendMessage} disabled={inputText.trim().length === 0}>
                <Feather name="send" size={20} color="#000" />
              </TouchableOpacity>
            </View>

            {isPlusMenuOpen && (
              <View style={styles.accessoryBar}>
                <ActionItem icon="image" label="照片" color="#007AFF" onPress={pickImageAndSend} />
                <ActionItem 
                  icon="camera" 
                  label="拍摄" 
                  color="#34C759" 
                  onPress={() => takePhotoAndSend(false)} 
                  onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    takePhotoAndSend(true);
                  }} 
                />
                <ActionItem icon="file" label="文件" color="#FF9500" onPress={pickAndSendFile} />
              </View>
            )}
          </KeyboardAvoidingView>
        </View>

        <ImageView images={previewImages} imageIndex={0} visible={isPreviewVisible} onRequestClose={() => setPreviewVisible(false)} />

        {/* 视频播放弹窗 */}
        <Modal visible={!!previewVideoUrl} animationType="fade" transparent={false}>
          <View style={styles.videoModalContainer}>
            <TouchableOpacity style={styles.videoModalClose} onPress={() => setPreviewVideoUrl(null)}>
              <Feather name="x" size={30} color="#FFF" />
            </TouchableOpacity>
            {previewVideoUrl && (
              <Video
                source={{ uri: previewVideoUrl }}
                style={styles.fullVideo}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
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

              <TouchableOpacity onPress={() => { handleDownload(menuConfig.item!); closeMenu(); }} style={styles.menuItem}>
                <Feather name="download" size={18} color="#FFF" />
                <Text style={styles.menuItemText}>下载</Text>
              </TouchableOpacity>
              <View style={styles.menuArrow} />
            </View>
          </Pressable>
        )}

        {/* 全屏文本选择模式 */}
        <Modal visible={isFullScreenVisible} animationType="fade" transparent={false}>
          <View style={styles.fullScreenContent}>
            <View style={styles.fullScreenHeader}>
              <TouchableOpacity onPress={() => setFullScreenVisible(false)}>
                <Feather name="x" size={24} color="#FFF" />
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
        <CameraView style={StyleSheet.absoluteFillObject} onBarcodeScanned={handleBarcodeScanned} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} />
        <View style={styles.overlay}>
          <View style={styles.scanBox}><View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /></View>
          <Text style={styles.scanTip}>对准电脑端二维码</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsScanning(false)}><Text style={styles.cancelBtnText}>取消扫码</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.promptBox}>
        <View style={styles.heroIconBox}><Feather name="share-2" size={40} color="#FFF" /></View>
        <Text style={styles.promptTitle}>局域网速传</Text>
        <Text style={styles.promptDesc}>在电脑端 TieZ 中选择“文件传输”{"\n"}扫码瞬间开启连接</Text>
        <TouchableOpacity style={styles.mainActionBtn} onPress={() => setIsScanning(true)}><Feather name="maximize" size={20} color="#000" style={{ marginRight: 8 }} /><Text style={styles.mainActionText}>立即扫码</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function VideoThumbnailView({ uri }: { uri: string }) {
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
        <View style={[styles.videoThumb, { backgroundColor: '#1C1C1E' }]} />
      )}
    </View>
  );
}

function AutoHeightImage({ uri, maxWidth }: { uri: string; maxWidth: number }) {
  const [aspectRatio, setAspectRatio] = useState<number>(1);

  useEffect(() => {
    Image.getSize(uri, (w, h) => {
      if (w > 0 && h > 0) {
        setAspectRatio(w / h);
      }
    });
  }, [uri]);

  return (
    <Image 
      source={{ uri }} 
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

function ActionItem({ icon, label, color, onPress, onLongPress }: any) {
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
      <Text style={styles.accessoryText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  promptBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  heroIconBox: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  promptTitle: { fontSize: 24, fontWeight: '700', color: '#FFF', marginBottom: 12 },
  promptDesc: { color: '#8E8E93', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 40 },
  mainActionBtn: { backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 16 },
  mainActionText: { color: '#000', fontSize: 17, fontWeight: '600' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1C1C1E' },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 32 },
  messageRow: { marginBottom: 16, flexDirection: 'row', width: '100%' },
  myRow: { justifyContent: 'flex-end' },
  otherRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: width * 0.75, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden' },
  myBubble: { backgroundColor: '#FFF' },
  otherBubble: { backgroundColor: '#1C1C1E' },
  myText: { color: '#000', fontSize: 16, lineHeight: 22 },
  otherText: { color: '#FFF', fontSize: 16, lineHeight: 22 },
  fileContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fileName: { marginLeft: 8, fontSize: 14, flexShrink: 1 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, paddingBottom: Platform.OS === 'ios' ? 12 : 12, backgroundColor: '#000', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1C1C1E' },
  input: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#FFF', fontSize: 16, maxHeight: 100, marginHorizontal: 10 },
  plusBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  accessoryBar: { flexDirection: 'row', paddingVertical: 20, paddingHorizontal: 20, backgroundColor: '#000' },
  accessoryItem: { alignItems: 'center', marginRight: 32 },
  accessoryIcon: { width: 60, height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  accessoryText: { color: '#8E8E93', fontSize: 13 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },

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

  scanBox: { width: 260, height: 260, position: 'relative', marginBottom: 40 },
  corner: { width: 40, height: 40, position: 'absolute', borderColor: '#FFF', borderWidth: 4 },
  topLeft: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 24 },
  topRight: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 24 },
  bottomLeft: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 24 },
  bottomRight: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 24 },
  scanTip: { color: '#FFF', fontSize: 16, marginBottom: 60, fontWeight: '500' },
  cancelBtn: { padding: 12 },
  cancelBtnText: { color: '#8E8E93', fontSize: 16 },

  fullScreenContent: { flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'ios' ? 50 : 20 },
  fullScreenHeader: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1C1C1E' 
  },
  fullScreenTitle: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  fullScreenInput: { color: '#FFF', fontSize: 18, lineHeight: 28, textAlignVertical: 'top' },

  uploadProgressOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.3)', overflow: 'hidden'
  },
  progressBar: { height: '100%', backgroundColor: '#FFF' },

  fileProgressBarContainer: { height: 3, width: '100%', marginTop: 8, borderRadius: 2, overflow: 'hidden' },
  fileProgressBar: { height: '100%' },

  videoContainer: { width: width * 0.5, aspectRatio: 16/9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  videoThumbBox: { ...StyleSheet.absoluteFillObject },
  videoThumb: { width: '100%', height: '100%' },
  videoPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  
  videoModalContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  videoModalClose: { position: 'absolute', top: 50, left: 20, zIndex: 10 },
  fullVideo: { width: '100%', height: '100%' }
});
