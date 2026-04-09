import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Dimensions,
  Linking,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { useTheme } from '../theme/ThemeContext';
import {
  buildWebDavDisplayRecord,
  fetchWebDavEntries,
  formatRelativeTime,
  loadMobileSyncSettings,
  pushClipboardBatchToPc,
} from '../lib/sync';
import type { 
  LocalClipboardEntry, 
  MobileSyncSettings, 
  WebDavDisplayRecord,
} from '../lib/sync';

type HomeMode = 'push' | 'pull';
const EMPTY_PULL_RECORD: WebDavDisplayRecord = {
  tags: [],
  entriesByTag: {},
  recentEntries: [],
};

function isImagePreviewText(preview: string) {
  const normalized = preview.trim().toLowerCase();
  return normalized === '[image content]' || normalized === 'image content' || normalized === '图片';
}

function isImageUri(content: string) {
  const normalized = content.trim().toLowerCase();
  return normalized.startsWith('data:image/')
    || normalized.startsWith('file://')
    || normalized.startsWith('content://')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://');
}

function imageFileExtensionFromUri(content: string) {
  const normalized = content.trim().toLowerCase();
  if (normalized.startsWith('data:image/png')) return 'png';
  if (normalized.startsWith('data:image/webp')) return 'webp';
  if (normalized.startsWith('data:image/gif')) return 'gif';
  if (normalized.startsWith('data:image/bmp')) return 'bmp';
  if (normalized.startsWith('data:image/jpeg') || normalized.startsWith('data:image/jpg')) return 'jpg';

  const clean = normalized.split('?')[0]?.split('#')[0] ?? normalized;
  const matched = clean.match(/\.([a-z0-9]{2,5})$/);
  return matched?.[1] || 'jpg';
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<HomeMode>('push');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [settings, setSettings] = useState<MobileSyncSettings | null>(null);
  const hasAutoPushedRef = useRef(false);
  const [currentClipboardEntry, setCurrentClipboardEntry] = useState<LocalClipboardEntry | null>(null);
  const [pullRecord, setPullRecord] = useState<WebDavDisplayRecord>(EMPTY_PULL_RECORD);
  const [selectedPushIds, setSelectedPushIds] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<Array<{ id: string; text: string }>>([
    { id: 'manual-0', text: '' },
  ]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const feedbackAnim = useRef(new Animated.Value(0)).current;

  const showFeedback = useCallback((message: string) => {
    setFeedbackMessage(message);
    feedbackAnim.stopAnimation();
    feedbackAnim.setValue(0);
    Animated.sequence([
      Animated.timing(feedbackAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.delay(1200),
      Animated.timing(feedbackAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setFeedbackMessage(null);
      }
    });
  }, [feedbackAnim]);

  const saveImageToLibrary = useCallback(async (imageUri: string) => {
    if (!isImageUri(imageUri)) {
      Alert.alert('暂不可保存', '这张图片还没有同步完整，暂时无法保存到相册。');
      return;
    }

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要相册权限才能保存图片。');
        return;
      }

      let assetUri = imageUri;

      if (imageUri.startsWith('data:image/')) {
        const matched = imageUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!matched) {
          throw new Error('图片数据格式不正确');
        }

        const extension = imageFileExtensionFromUri(imageUri);
        const fileUri = `${LegacyFileSystem.cacheDirectory ?? LegacyFileSystem.documentDirectory ?? ''}tiez-sync-image-${Date.now()}.${extension}`;
        await LegacyFileSystem.writeAsStringAsync(fileUri, matched[2], {
          encoding: LegacyFileSystem.EncodingType.Base64,
        });
        assetUri = fileUri;
      } else if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
        const extension = imageFileExtensionFromUri(imageUri);
        const fileUri = `${LegacyFileSystem.cacheDirectory ?? LegacyFileSystem.documentDirectory ?? ''}tiez-sync-image-${Date.now()}.${extension}`;
        const downloadResult = await LegacyFileSystem.downloadAsync(imageUri, fileUri);
        assetUri = downloadResult.uri;
      }

      await MediaLibrary.saveToLibraryAsync(assetUri);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showFeedback('已保存到相册');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存图片失败';
      Alert.alert('保存失败', message);
    }
  }, [showFeedback]);

  const captureClipboardSnapshot = useCallback(async () => {
    try {
      const current = (await Clipboard.getStringAsync()).trim();
      if (!current) {
        setCurrentClipboardEntry(null);
        return null;
      }

      const nextEntry = {
        id: 'current-clipboard',
        content: current,
        createdAt: Date.now(),
      };

      setCurrentClipboardEntry(nextEntry);
      setSelectedPushIds(prev => prev.includes('current-clipboard') ? prev : [...prev, 'current-clipboard']);
      return nextEntry;
    } catch (e) {
      return null;
    }
  }, []);

  const loadHomeData = useCallback(async (withRefreshState = false) => {
    if (withRefreshState) setRefreshing(true);
    else setIsLoading(true);

    try {
      const nextSettings = await loadMobileSyncSettings();
      setSettings(nextSettings);

      const clipboardEntry = await captureClipboardSnapshot();

      // 智能自动推送逻辑（仅在设置开启且本次启动未推送时执行）
      if (clipboardEntry && nextSettings.autoPushOnLaunch && !hasAutoPushedRef.current) {
        hasAutoPushedRef.current = true;
        pushClipboardBatchToPc([clipboardEntry]).catch(() => {});
      }

      // 如果当前已经是 pull 模式（比如从设置页返回），则需要顺带加载远程数据
      if (mode === 'pull') {
        const entries = await fetchWebDavEntries(nextSettings)
          .then((entries) => buildWebDavDisplayRecord(entries, nextSettings.recentLimit))
          .catch(() => EMPTY_PULL_RECORD);
        setPullRecord(entries);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载本地数据失败';
      Alert.alert('加载失败', message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [captureClipboardSnapshot, mode]);

  // 当用户切换到拉取模式时，如果当前数据为空或需要更新，主动触发拉取
  useEffect(() => {
    if (mode === 'pull' && settings) {
      const doFetchPull = async () => {
        setIsLoading(true);
        try {
          const entries = await fetchWebDavEntries(settings)
            .then((entries) => buildWebDavDisplayRecord(entries, settings.recentLimit))
            .catch(() => EMPTY_PULL_RECORD);
          setPullRecord(entries);
        } finally {
          setIsLoading(false);
        }
      };
      
      // 只有在没有记录或者用户主动切换时才触发
      if (pullRecord.recentEntries.length === 0) {
        doFetchPull();
      }
    }
  }, [mode, settings]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

  // 处理来自 Android 磁贴按钮及长按图标快捷菜单的指令
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;
      
      // 1. 文件传输
      if (url.includes('scanner')) {
        triggerHaptic();
        navigation.navigate('Scanner' as any);
        return;
      }

      // 2. 获取 PC 端内容
      if (url.includes('sync-pull')) {
        triggerHaptic();
        setMode('pull');
        setIsLoading(true);
        try {
          const nextSettings = await loadMobileSyncSettings();
          const entries = await fetchWebDavEntries(nextSettings)
            .then((entries) => buildWebDavDisplayRecord(entries, nextSettings.recentLimit));
          
          setPullRecord(entries);
          
          if (entries.recentEntries.length > 0) {
            const first = entries.recentEntries[0];
            if (first.msg_type === 'text') {
              await Clipboard.setStringAsync(first.content);
              Alert.alert('同步成功', `已自动复制最新内容：\n${first.content.substring(0, 50)}${first.content.length > 50 ? '...' : ''}`);
            }
          }
        } catch (err: any) {
          Alert.alert('获取失败', err.message);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // 3. 同步内容到 PC (包含了之前的 sync-now 指令)
      if (url.includes('sync-push') || url.includes('sync-now')) {
        setMode('push');
        const clipboardEntry = await captureClipboardSnapshot();
        if (clipboardEntry) {
          triggerHaptic();
          pushClipboardBatchToPc([clipboardEntry])
            .then(() => {
              loadHomeData();
            })
            .catch((err) => {
              Alert.alert('快捷同步失败', err.message);
            });
        }
      }
    };

    // 监听运行中的打开
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // 检查是否是通过点击磁贴启动的应用
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    return () => {
      subscription.remove();
    };
  }, [loadHomeData, captureClipboardSnapshot]);

  useEffect(() => {
    setSelectedPushIds((current) =>
      current.filter((id) => {
        if (id === 'current-clipboard') return Boolean(currentClipboardEntry);
        if (id.startsWith('manual-')) {
          return manualInputs.some(input => input.id === id && input.text.trim().length > 0);
        }
        return false;
      })
    );
  }, [currentClipboardEntry, manualInputs]);

  const togglePushSelection = useCallback((id: string) => {
    Haptics.selectionAsync();
    setSelectedPushIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }, []);

  const pushEntries = useMemo(() => {
    const entries: LocalClipboardEntry[] = [];
    if (currentClipboardEntry) {
      entries.push(currentClipboardEntry);
    }
    manualInputs.forEach((input) => {
      const trimmed = input.text.trim();
      if (trimmed) {
        entries.push({
          id: input.id,
          content: trimmed,
          createdAt: Date.now(),
        });
      }
    });
    return entries;
  }, [currentClipboardEntry, manualInputs]);

  const toggleSelectAllPushEntries = useCallback(() => {
    Haptics.selectionAsync();
    setSelectedPushIds((current) =>
      current.length === pushEntries.length ? [] : pushEntries.map((entry) => entry.id)
    );
  }, [pushEntries]);

  const pushSelectedEntries = useCallback(async () => {
    const selectedEntries = pushEntries.filter((entry) => selectedPushIds.includes(entry.id));
    if (selectedEntries.length === 0) {
      Alert.alert('请选择内容', '先选择要推送到电脑端的剪贴板条目');
      return;
    }

    setIsPushing(true);
    try {
      await pushClipboardBatchToPc(selectedEntries);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showFeedback(`已推送 ${selectedEntries.length} 条`);
      setSelectedPushIds([]);
      setManualInputs([{ id: `manual-${Date.now()}`, text: '' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '推送失败';
      Alert.alert('推送失败', message);
    } finally {
      setIsPushing(false);
    }
  }, [pushEntries, selectedPushIds]);

  const refreshPushPage = useCallback(async () => {
    setRefreshing(true);
    try {
      await captureClipboardSnapshot();
    } finally {
      setRefreshing(false);
    }
  }, [captureClipboardSnapshot]);

  const refreshPullPage = useCallback(async () => {
    setRefreshing(true);
    try {
      const nextSettings = await loadMobileSyncSettings();
      setSettings(nextSettings);
      const webDavRecord = buildWebDavDisplayRecord(
        await fetchWebDavEntries(nextSettings),
        nextSettings.recentLimit
      );
      setPullRecord(webDavRecord);
      setSelectedTag((current) => {
        if (!current) return null;
        return webDavRecord.tags.includes(current) ? current : null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '拉取失败';
      Alert.alert('拉取失败', message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const pullTags = pullRecord.tags;
  const visiblePullEntries = useMemo(() => {
    if (!selectedTag) return pullRecord.recentEntries;
    return pullRecord.entriesByTag[selectedTag] ?? [];
  }, [pullRecord, selectedTag]);

  const dynamicStyles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hugeTitle: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
    topChrome: {
      paddingTop: insets.top,
      paddingHorizontal: 20,
      paddingBottom: 2,
      backgroundColor: colors.background,
    },
    segmentedControl: {
      flexDirection: 'row',
      backgroundColor: colors.iconBackground,
      borderRadius: 16,
      padding: 4,
      marginBottom: 8,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnActive: { backgroundColor: colors.primary },
    segmentBtnText: { color: colors.subText, fontSize: 15, fontWeight: '600' },
    segmentBtnTextActive: { color: colors.primaryText },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.subText,
      marginBottom: 14,
      textTransform: 'uppercase',
    },
    primaryAction: {
      backgroundColor: colors.primary,
      borderRadius: 16,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      opacity: isPushing ? 0.75 : 1,
    },
    primaryActionText: { color: colors.primaryText, fontSize: 16, fontWeight: '700', marginLeft: 8 },
    secondaryAction: {
      backgroundColor: colors.card,
      borderRadius: 16,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    secondaryActionText: { color: colors.text, fontSize: 15, fontWeight: '600', marginLeft: 8 },
    rowActions: { flexDirection: 'row', gap: 12, marginBottom: 26 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 16,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    selectedCard: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    cardTitle: { color: colors.text, fontSize: 16, lineHeight: 22 },
    cardMeta: { color: colors.subText, fontSize: 13, marginTop: 8 },
    imagePreview: {
      width: '100%',
      height: 180,
      borderRadius: 14,
      backgroundColor: colors.iconBackground,
      marginBottom: 12,
    },
    imageFallback: {
      width: '100%',
      height: 180,
      borderRadius: 14,
      backgroundColor: colors.iconBackground,
      marginBottom: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    imageFallbackText: {
      color: colors.subText,
      fontSize: 14,
      fontWeight: '500',
    },
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 18,
      marginBottom: 20,
    },
    infoTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
    infoText: { color: colors.subText, fontSize: 14, lineHeight: 22 },
    manualInput: {
      minHeight: 88,
      borderRadius: 14,
      backgroundColor: colors.iconBackground,
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 14,
      textAlignVertical: 'top',
    },
    tagPill: {
      backgroundColor: colors.tagPill,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
      marginRight: 10,
    },
    tagPillActive: { backgroundColor: colors.tagPillActive },
    tagText: { color: colors.subText, fontSize: 15, fontWeight: '500' },
    tagTextActive: { color: colors.tagTextActive, fontWeight: '600' },
    emptyText: { color: colors.subText, fontSize: 14, lineHeight: 22, textAlign: 'center' },
    bottomHint: {
      color: colors.subText,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 12,
    },
    pushBottomActionsWrap: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 75, 
    },
    cardSelectionIndicator: {
      position: 'absolute',
      bottom: 12,
      right: 12,
    },
    feedbackToast: {
      position: 'absolute',
      alignSelf: 'center',
      minWidth: 96,
      maxWidth: 160,
      bottom: 156 + Math.max(insets.bottom, 12),
      backgroundColor: colors.card,
      borderRadius: 999,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 5,
      zIndex: 999,
    },
    feedbackText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
  });

  const renderPushPage = () => (
    <>
      <TouchableOpacity
        style={[
          dynamicStyles.card,
          selectedPushIds.includes('current-clipboard') && dynamicStyles.selectedCard,
        ]}
        activeOpacity={currentClipboardEntry ? 0.75 : 1}
        onPress={() => currentClipboardEntry && togglePushSelection('current-clipboard')}
      >
        <View style={styles.cardContent}>
          <Text style={dynamicStyles.cardTitle} numberOfLines={4}>
            {currentClipboardEntry?.content || '当前手机剪贴板还是空的，下拉后再试一次。'}
          </Text>
          <Text style={dynamicStyles.cardMeta}>第一条 · 当前剪贴板</Text>
        </View>
        <View style={dynamicStyles.cardSelectionIndicator}>
           <Feather
            name={selectedPushIds.includes('current-clipboard') ? 'check-circle' : 'circle'}
            size={18}
            color={selectedPushIds.includes('current-clipboard') ? colors.primary : colors.divider}
          />
        </View>
      </TouchableOpacity>

      {manualInputs.map((input, index) => {
        const isLast = index === manualInputs.length - 1;
        const isSelected = selectedPushIds.includes(input.id);
        
        return (
          <View
            key={input.id}
            style={[
              dynamicStyles.card,
              isSelected && dynamicStyles.selectedCard,
              { padding: 4, marginTop: index === 0 ? 0 : 4 }
            ]}
          >
            <TextInput
              value={input.text}
              onChangeText={(value) => {
                const next = [...manualInputs];
                next[index] = { ...input, text: value };
                
                if (isLast && value.trim().length > 0) {
                  next.push({ id: `manual-${Date.now()}`, text: '' });
                }
                
                if (value.trim().length === 0 && index < next.length - 1 && next.length > 1) {
                  next.splice(index, 1);
                }

                setManualInputs(next);

                if (value.trim() && !selectedPushIds.includes(input.id)) {
                  setSelectedPushIds((current) => [...current, input.id]);
                } else if (!value.trim()) {
                  setSelectedPushIds((current) => current.filter(item => item !== input.id));
                }
              }}
              placeholder={index === 0 ? "在此输入内容，即刻推送至 PC..." : "继续输入下一条..."}
              placeholderTextColor={colors.subText}
              style={[dynamicStyles.manualInput, { marginBottom: 0, backgroundColor: 'transparent', minHeight: 60, paddingRight: 32 }]}
              multiline
            />
            {input.text.trim().length > 0 && (
              <View style={dynamicStyles.cardSelectionIndicator}>
                <Feather
                  name={isSelected ? 'check-circle' : 'circle'}
                  size={18}
                  color={isSelected ? colors.primary : colors.divider}
                />
              </View>
            )}
          </View>
        );
      })}

      <View style={styles.pushBottomSpacer} />
    </>
  );

  const renderPullPage = () => (
    <>
      {!settings?.webdavUrl ? (
        <View style={dynamicStyles.infoCard}>
          <Text style={dynamicStyles.infoTitle}>先配置 WebDAV</Text>
          <Text style={dynamicStyles.infoText}>到设置页填写 WebDAV 地址、账号、密码和基础路径后，拉取页才会显示 PC 端的主记录。</Text>
        </View>
      ) : null}

      <Text style={dynamicStyles.sectionTitle}>标签</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={{ paddingRight: 20 }}>
        <TouchableOpacity
          style={[dynamicStyles.tagPill, selectedTag === null && dynamicStyles.tagPillActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setSelectedTag(null);
          }}
        >
          <Text style={[dynamicStyles.tagText, selectedTag === null && dynamicStyles.tagTextActive]}>最近</Text>
        </TouchableOpacity>
        {pullTags.map((tag) => (
          <TouchableOpacity
            key={tag}
            style={[dynamicStyles.tagPill, selectedTag === tag && dynamicStyles.tagPillActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setSelectedTag(tag);
            }}
          >
            <Text style={[dynamicStyles.tagText, selectedTag === tag && dynamicStyles.tagTextActive]}>{tag}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={dynamicStyles.sectionTitle}>
        主记录
        {selectedTag
          ? ` · ${selectedTag} 下全部 ${visiblePullEntries.length} 条`
          : settings
            ? ` · 最近 ${settings.recentLimit} 条`
            : ''}
      </Text>
      {visiblePullEntries.length > 0 ? (
        visiblePullEntries.map((entry) => (
          (() => {
            const isImageEntry = entry.content_type === 'image'
              || isImagePreviewText(entry.preview)
              || isImageUri(entry.content);
            const hasImageUri = isImageUri(entry.content);

            return (
              <TouchableOpacity
                key={entry.id}
                style={dynamicStyles.card}
                activeOpacity={isImageEntry ? 1 : 0.75}
                onPress={async () => {
                  if (isImageEntry) {
                    return;
                  }

                  await Clipboard.setStringAsync(entry.content);
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  showFeedback('已复制');
                }}
                onLongPress={() => {
                  if (!isImageEntry) return;
                  Haptics.selectionAsync();
                  Alert.alert(
                    '图片操作',
                    '你可以把这张同步图片保存到系统相册。',
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '保存到相册',
                        onPress: () => {
                          void saveImageToLibrary(entry.content);
                        },
                      },
                    ]
                  );
                }}
              >
                {isImageEntry ? (
              <>
                {hasImageUri ? (
                  <Image
                    source={{ uri: entry.content }}
                    style={dynamicStyles.imagePreview}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={dynamicStyles.imageFallback}>
                    <Feather name="image" size={28} color={colors.subText} />
                    <Text style={dynamicStyles.imageFallbackText}>图片已同步</Text>
                  </View>
                )}
                <Text style={dynamicStyles.cardTitle} numberOfLines={1}>
                  图片
                </Text>
                <Text style={dynamicStyles.cardMeta}>
                  {formatRelativeTime(entry.timestamp)}
                  {entry.source_app ? ` · ${entry.source_app}` : ''}
                </Text>
              </>
                ) : (
              <View style={styles.cardRow}>
                <Feather
                  name={entry.preview.startsWith('http') ? 'link' : 'file-text'}
                  size={20}
                  color={colors.subText}
                />
                <View style={styles.cardContent}>
                  <Text style={dynamicStyles.cardTitle} numberOfLines={3}>
                    {entry.preview || entry.content}
                  </Text>
                  <Text style={dynamicStyles.cardMeta}>
                    {formatRelativeTime(entry.timestamp)}
                    {entry.source_app ? ` · ${entry.source_app}` : ''}
                  </Text>
                </View>
              </View>
                )}
              </TouchableOpacity>
            );
          })()
        ))
      ) : (
        <View style={dynamicStyles.infoCard}>
          <Text style={dynamicStyles.emptyText}>
            {settings?.webdavUrl ? '当前还没有拉取到 PC 端的最新记录，下拉试试。' : '配置完成后，这里会显示 PC 端的主记录。'}
          </Text>
        </View>
      )}
    </>
  );

  return (
    <View style={dynamicStyles.container}>
      {feedbackMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            dynamicStyles.feedbackToast,
            {
              opacity: feedbackAnim,
              transform: [
                {
                  translateY: feedbackAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-16, 0],
                  }),
                },
                {
                  scale: feedbackAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={dynamicStyles.feedbackText}>{feedbackMessage}</Text>
        </Animated.View>
      ) : null}

      <View style={dynamicStyles.topChrome}>
        <View style={styles.header}>
          <Text style={dynamicStyles.hugeTitle}>TieZ</Text>
        </View>

        <View style={dynamicStyles.segmentedControl}>
          <TouchableOpacity
            style={[dynamicStyles.segmentBtn, mode === 'push' && dynamicStyles.segmentBtnActive]}
            onPress={() => setMode('push')}
          >
            <Text style={[dynamicStyles.segmentBtnText, mode === 'push' && dynamicStyles.segmentBtnTextActive]}>推送</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[dynamicStyles.segmentBtn, mode === 'pull' && dynamicStyles.segmentBtnActive]}
            onPress={() => setMode('pull')}
          >
            <Text style={[dynamicStyles.segmentBtnText, mode === 'pull' && dynamicStyles.segmentBtnTextActive]}>拉取</Text>
          </TouchableOpacity>
        </View>
      </View>


      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          mode === 'push' && !isLoading
            ? [styles.pushScrollContent, { paddingBottom: 190 + Math.max(insets.bottom, 12) }]
            : styles.pullScrollContent,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={mode === 'push' ? refreshPushPage : refreshPullPage}
            tintColor={colors.text}
          />
        }
      >

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : mode === 'push' ? (
          renderPushPage()
        ) : (
          renderPullPage()
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {mode === 'push' && !isLoading ? (
        <View style={dynamicStyles.pushBottomActionsWrap}>
          <Text style={dynamicStyles.bottomHint}>下拉会重新读取当前手机剪贴板。</Text>
          <View style={dynamicStyles.rowActions}>
            <TouchableOpacity style={[dynamicStyles.secondaryAction, styles.flexAction]} onPress={toggleSelectAllPushEntries}>
              <Feather name="check-square" size={18} color={colors.text} />
              <Text style={dynamicStyles.secondaryActionText}>
                {selectedPushIds.length === pushEntries.length && pushEntries.length > 0 ? '取消全选' : '全选'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dynamicStyles.primaryAction, styles.flexAction]}
              onPress={pushSelectedEntries}
              disabled={isPushing}
            >
              {isPushing ? (
                <ActivityIndicator size="small" color={colors.primaryText} />
              ) : (
                <Feather name="upload-cloud" size={18} color={colors.primaryText} />
              )}
              <Text style={dynamicStyles.primaryActionText}>推送选中项</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20 },
  pushScrollContent: { paddingTop: 6 },
  pullScrollContent: { paddingTop: 8, paddingBottom: 100 },
  header: { marginBottom: 0 },
  flexAction: { flex: 1 },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  tagScroll: { marginBottom: 24, flexDirection: 'row' },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  cardContent: { flex: 1, marginLeft: 14 },
  pushBottomSpacer: { height: 20 },
});
