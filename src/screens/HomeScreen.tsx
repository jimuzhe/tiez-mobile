import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeContext';
import {
  collectTags,
  fetchWebDavEntries,
  filterRecentEntries,
  formatRelativeTime,
  loadMobileSyncSettings,
  pushClipboardBatchToPc,
} from '../lib/sync';
import type { 
  LocalClipboardEntry, 
  MobileSyncSettings, 
  SyncedEntry, 
  RecentLimit 
} from '../lib/sync';

type HomeMode = 'push' | 'pull';

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
  const [pullEntries, setPullEntries] = useState<SyncedEntry[]>([]);
  const [selectedPushIds, setSelectedPushIds] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<Array<{ id: string; text: string }>>([
    { id: 'manual-0', text: '' },
  ]);

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

      const [clipboardEntry, webDavEntries] = await Promise.all([
        captureClipboardSnapshot(),
        fetchWebDavEntries(nextSettings).catch(() => []),
      ]);

      setPullEntries(webDavEntries);
      setSelectedTag((current) => {
        if (!current) return null;
        return webDavEntries.some((entry) => entry.tags.includes(current)) ? current : null;
      });

      // 智能自动推送逻辑
      if (clipboardEntry && nextSettings.autoPushOnLaunch && !hasAutoPushedRef.current) {
        hasAutoPushedRef.current = true;
        pushClipboardBatchToPc([clipboardEntry]).catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载同步页面失败';
      Alert.alert('读取失败', message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [captureClipboardSnapshot]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData])
  );

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
      Alert.alert('推送成功', `已推送 ${selectedEntries.length} 条内容到电脑端`);
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
      const webDavEntries = await fetchWebDavEntries(nextSettings);
      setPullEntries(webDavEntries);
      setSelectedTag((current) => {
        if (!current) return null;
        return webDavEntries.some((entry) => entry.tags.includes(current)) ? current : null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '拉取失败';
      Alert.alert('拉取失败', message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const pullTags = useMemo(() => collectTags(pullEntries), [pullEntries]);
  const visiblePullEntries = useMemo(() => {
    if (!settings) return [];
    return filterRecentEntries(pullEntries, selectedTag, settings.recentLimit);
  }, [pullEntries, selectedTag, settings]);

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
        {settings ? ` · 最近${settings.recentLimit}条` : ''}
      </Text>
      {visiblePullEntries.length > 0 ? (
        visiblePullEntries.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={dynamicStyles.card}
            activeOpacity={0.75}
            onPress={async () => {
              await Clipboard.setStringAsync(entry.content);
              Haptics.selectionAsync();
            }}
          >
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
          </TouchableOpacity>
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
