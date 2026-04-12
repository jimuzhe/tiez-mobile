import { StyleSheet, Text, View, TouchableOpacity, Image, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useHaptics } from '../context/HapticContext';

export default function AboutScreen() {
  const { colors, isDark } = useTheme();
  const { triggerHaptic } = useHaptics();

  const handleLink = (url: string) => {
    triggerHaptic('light');
    Linking.openURL(url);
  };

  const dynamicStyles = StyleSheet.create({
    container: {
      paddingBottom: 10,
    },
    dragHandle: {
      width: 40,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.divider,
      alignSelf: 'center',
      marginTop: 12,
    },
    content: {
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingBottom: 20,
    },
    version: {
      fontSize: 13,
      color: colors.subText,
      fontWeight: '500',
    },
    intro: {
      fontSize: 14,
      color: colors.text,
      textAlign: 'center',
      lineHeight: 22,
      opacity: 0.9,
    },
    card: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
    },
    iconBox: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.iconBackground,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    linkText: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      fontWeight: '500',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 58,
    },
    footer: {
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: colors.subText,
      opacity: 0.7,
    },
  });

  return (
    <View style={dynamicStyles.container}>
      <View style={dynamicStyles.dragHandle} />
      
      <View style={dynamicStyles.content}>
        <Image 
          source={require('../../assets/logo.png')} 
          style={{ width: 180, height: 60, marginTop: 15 }} 
          resizeMode="contain"
        />

        <Text style={[dynamicStyles.version, { marginTop: 4 }]}>Version 0.0.1</Text>

        <Text style={[dynamicStyles.intro, { marginTop: 14, textAlign: 'center' }]}>
          极简而不简单。{"\n"}捕捉每一份灵感，赋能每一次粘贴。
        </Text>

        <View style={[dynamicStyles.card, { marginTop: 20 }]}>
          <TouchableOpacity style={dynamicStyles.linkRow} onPress={() => handleLink('https://tiez.name666.top/zh/')}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="globe" size={16} color="#007AFF" />
            </View>
            <Text style={dynamicStyles.linkText}>官方网站</Text>
            <Feather name="external-link" size={14} color={colors.subText} />
          </TouchableOpacity>
          
          <View style={dynamicStyles.divider} />

          <TouchableOpacity style={dynamicStyles.linkRow} onPress={() => handleLink('https://github.com/jimuzhe/tiez-clipboard')}>
            <View style={dynamicStyles.iconBox}>
              <Feather name="github" size={16} color={isDark ? '#FFF' : '#000'} />
            </View>
            <Text style={dynamicStyles.linkText}>开源地址</Text>
            <Feather name="external-link" size={14} color={colors.subText} />
          </TouchableOpacity>
        </View>

        <View style={[dynamicStyles.footer, { marginTop: 24 }]}>
          <Text style={dynamicStyles.footerText}>Made with ❤️ by LongDz</Text>
        </View>
      </View>
    </View>
  );
}
