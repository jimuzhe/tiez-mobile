import { StyleSheet, Text, View, ScrollView, TouchableOpacity, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState, useRef, useEffect } from 'react';

export default function SettingsScreen() {
  // 0: Off, 1-5: gears of vibration
  const [hapticLevel, setHapticLevel] = useState<number>(3);
  const [theme, setTheme] = useState<'System' | 'Dark' | 'Light'>('System');

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const hapticLevelRef = useRef(hapticLevel);
  
  useEffect(() => { 
    hapticLevelRef.current = hapticLevel; 
    trackWidthRef.current = trackWidth;
    AsyncStorage.setItem('hapticLevel', hapticLevel.toString());
  }, [hapticLevel, trackWidth]);

  useEffect(() => {
    AsyncStorage.getItem('hapticLevel').then(val => {
      if (val) setHapticLevel(parseInt(val));
    });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleHapticDrag(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleHapticDrag(evt.nativeEvent.locationX),
    })
  ).current;

  const handleHapticDrag = (x: number) => {
    const w = trackWidthRef.current;
    if (w === 0) return;
    const clampedX = Math.max(0, Math.min(x, w - 0.1));
    const newLevel = Math.floor((clampedX / w) * 6);
    if (newLevel !== hapticLevelRef.current && newLevel >= 0 && newLevel <= 5) {
      setHapticLevel(newLevel);
      triggerHaptic(newLevel);
    }
  };

  const triggerHaptic = (level = hapticLevel) => {
    if (level === 0) return;
    const style = 
      level >= 4 ? Haptics.ImpactFeedbackStyle.Heavy :
      level >= 2 ? Haptics.ImpactFeedbackStyle.Medium : 
      Haptics.ImpactFeedbackStyle.Light;
    
    Haptics.impactAsync(style);
  };

  const cycleTheme = () => {
    triggerHaptic();
    const next = theme === 'System' ? 'Dark' : theme === 'Dark' ? 'Light' : 'System';
    setTheme(next);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.hugeTitle}>设置</Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => triggerHaptic()}>
            <View style={styles.iconBox}>
              <Feather name="server" size={18} color="#FFF" />
            </View>
            <Text style={styles.rowText}>WebDAV 服务器</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>配置同步服务的网络地址与账号</Text>

        <View style={[styles.card, { marginTop: 30 }]}>
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={cycleTheme}>
            <View style={styles.iconBox}>
              <Feather name={theme === 'System' ? 'monitor' : theme === 'Dark' ? 'moon' : 'sun'} size={18} color="#FFF" />
            </View>
            <Text style={styles.rowText}>主题模式</Text>
            <Text style={styles.valueText}>
              {theme === 'System' ? '跟随系统' : theme === 'Dark' ? '深色' : '浅色'}
            </Text>
            <Feather name="chevron-right" size={20} color="#666" style={{marginLeft: 8}} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionFooter}>目前仅提供深色极致极简风格适配</Text>

        <View style={[styles.card, { marginTop: 30 }]}>
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, width: '100%' }}>
              <View style={styles.iconBox}>
                <Feather name="smartphone" size={18} color="#FFF" />
              </View>
              <Text style={styles.rowText}>触觉反馈强度</Text>
              <Text style={[styles.valueText, { marginLeft: 16 }]}>
                {hapticLevel === 0 ? '关闭' : `${hapticLevel} 档`}
              </Text>
            </View>
            
            {/* 支持点击与丝滑拖拽的刻度条 */}
            <View 
              style={styles.segmentedSlider} 
              onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
              {...panResponder.panHandlers}
            >
              {[0, 1, 2, 3, 4, 5].map((level) => (
                <View 
                  key={level}
                  style={styles.segmentTouch}
                  pointerEvents="none"
                >
                  <View style={[
                    styles.segmentBar,
                    { 
                      backgroundColor: level === 0 ? 'transparent' : hapticLevel >= level ? '#FFFFFF' : '#38383A',
                      borderTopLeftRadius: level === 1 ? 4 : 0,
                      borderBottomLeftRadius: level === 1 ? 4 : 0,
                      borderTopRightRadius: level === 5 ? 4 : 0,
                      borderBottomRightRadius: level === 5 ? 4 : 0,
                    }
                  ]}>
                    {level === 0 && (
                      <Text style={{
                        color: hapticLevel === 0 ? '#FFFFFF' : '#8E8E93', 
                        fontSize: 13, fontWeight: '600', marginLeft: -8
                      }}>关</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
            
          </View>
        </View>
        <Text style={styles.sectionFooter}>0档为关闭，1-5档可精细调节点击时的马达震动幅度</Text>

        <View style={[styles.card, { marginTop: 30 }]}>
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => triggerHaptic()}>
            <View style={styles.iconBox}>
              <Feather name="message-square" size={18} color="#FFF" />
            </View>
            <Text style={styles.rowText}>意见反馈</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => triggerHaptic()}>
            <View style={styles.iconBox}>
              <Feather name="info" size={18} color="#FFF" />
            </View>
            <Text style={styles.rowText}>关于</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => triggerHaptic()}>
            <View style={styles.iconBox}>
              <Feather name="arrow-up-circle" size={18} color="#FFF" />
            </View>
            <Text style={styles.rowText}>检查更新</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
        </View>
        
        <Text style={styles.version}>TieZ v2.0.0</Text>
        <View style={{height: 100}} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { paddingTop: 80, paddingHorizontal: 20 },
  header: { marginBottom: 30 },
  hugeTitle: { fontSize: 36, fontWeight: '700', color: '#FFFFFF' },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  rowText: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '400' },
  valueText: { color: '#8E8E93', fontSize: 17 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#38383A', marginLeft: 64 },
  sectionFooter: { marginTop: 8, marginLeft: 16, color: '#8E8E93', fontSize: 13 },
  version: { textAlign: 'center', marginTop: 40, color: '#666', fontSize: 14 },
  segmentedSlider: {
    flexDirection: 'row', height: 40, alignItems: 'center', marginTop: 8, paddingHorizontal: 4
  },
  segmentTouch: {
    flex: 1, height: '100%', justifyContent: 'center',
  },
  segmentBar: {
    height: 8, marginHorizontal: 2, 
    justifyContent: 'center', alignItems: 'center'
  }
});
