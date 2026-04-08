import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function HomeScreen() {
  const triggerSync = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: 实现获取手机剪贴板并上传的逻辑
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.hugeTitle}>TieZ</Text>
        </View>

        {/* 悬浮的一键同步大按钮 */}
        <TouchableOpacity activeOpacity={0.8} onPress={triggerSync} style={styles.syncButton}>
          <Feather name="upload-cloud" size={22} color="#000" />
          <Text style={styles.syncButtonText}>同步当前剪贴板</Text>
        </TouchableOpacity>

        {/* 标签列表 (横向滚动) */}
        <Text style={styles.sectionTitle}>分类标签</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={{ paddingRight: 20 }}>
          {['全部', '#代码', '#图片', '#密码', '#链接'].map((tag, idx) => (
            <TouchableOpacity key={idx} style={[styles.tagPill, idx === 0 && styles.tagPillActive]} onPress={() => Haptics.selectionAsync()}>
              <Text style={[styles.tagText, idx === 0 && styles.tagTextActive]}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* PC 端最新剪贴板列表假数据 */}
        <Text style={styles.sectionTitle}>最近记录</Text>
        {[
          { id: 1, text: 'git commit -m "style: minimalist UI redesign"', time: '刚刚', type: 'text' },
          { id: 2, text: 'https://dav.example.com/api', time: '10分钟前', type: 'link' },
          { id: 3, text: 'Hello World', time: '1小时前', type: 'text' },
        ].map((item) => (
          <TouchableOpacity key={item.id} style={styles.clipCard} activeOpacity={0.7} onPress={() => Haptics.selectionAsync()}>
            <Feather name={item.type === 'link' ? 'link' : 'file-text'} size={20} color="#8E8E93" />
            <View style={styles.clipContent}>
                <Text style={styles.clipText} numberOfLines={2}>{item.text}</Text>
                <Text style={styles.clipTime}>{item.time}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <View style={{height: 100}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { paddingTop: 80, paddingHorizontal: 20 },
  header: { marginBottom: 30 },
  hugeTitle: { fontSize: 36, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 },
  syncButton: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 16, marginBottom: 30,
  },
  syncButtonText: { color: '#000000', fontSize: 17, fontWeight: '600', marginLeft: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#8E8E93', marginBottom: 16, textTransform: 'uppercase' },
  tagScroll: { marginBottom: 30, flexDirection: 'row' },
  tagPill: {
    backgroundColor: '#1C1C1E', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12, marginRight: 10,
  },
  tagPillActive: { backgroundColor: '#FFFFFF' },
  tagText: { color: '#8E8E93', fontSize: 15, fontWeight: '500' },
  tagTextActive: { color: '#000000', fontWeight: '600' },
  clipCard: {
    backgroundColor: '#1C1C1E', borderRadius: 16, padding: 18, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center'
  },
  clipContent: { marginLeft: 16, flex: 1 },
  clipText: { color: '#FFFFFF', fontSize: 16, fontWeight: '400', marginBottom: 6, lineHeight: 22 },
  clipTime: { color: '#8E8E93', fontSize: 13 }
});
