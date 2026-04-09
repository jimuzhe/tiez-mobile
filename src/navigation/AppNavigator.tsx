import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from '../screens/HomeScreen';
import ScannerScreen from '../screens/ScannerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  const { colors, isDark } = useTheme();

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} translucent />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarShowLabel: true,
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.subText,
          tabBarStyle: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            elevation: 0,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.divider,
            backgroundColor: 'transparent',
            height: 85,
            paddingBottom: 25,
            paddingTop: 10,
          },
          tabBarBackground: () => (
            <BlurView
              tint={isDark ? 'dark' : 'light'}
              intensity={95}
              style={StyleSheet.absoluteFill}
            />
          ),
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: any = 'circle';
            if (route.name === 'Home') iconName = 'clipboard';
            else if (route.name === 'Scanner') iconName = 'file';
            else if (route.name === 'Settings') iconName = 'settings';
            return <Feather name={iconName} size={24} color={color} />;
          },
        })}
        screenListeners={{
          tabPress: (e) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          },
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: '同步' }} />
        <Tab.Screen name="Scanner" component={ScannerScreen} options={{ title: '文件传输' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
