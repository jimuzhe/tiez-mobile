import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

type HapticStyle = Haptics.ImpactFeedbackStyle | 'selection' | 'success' | 'warning' | 'error' | 'light' | 'medium' | 'heavy';

interface HapticContextType {
  hapticLevel: number;
  setHapticLevel: (level: number) => Promise<void>;
  triggerHaptic: (style?: HapticStyle) => void;
}

const HapticContext = createContext<HapticContextType | undefined>(undefined);

export const HapticProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hapticLevel, setLevel] = useState<number>(3);

  useEffect(() => {
    AsyncStorage.getItem('hapticLevel').then(val => {
      if (val !== null) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) setLevel(parsed);
      }
    });
  }, []);

  const setHapticLevel = async (level: number) => {
    setLevel(level);
    await AsyncStorage.setItem('hapticLevel', level.toString());
  };

  const triggerHaptic = useCallback((style?: HapticStyle) => {
    if (hapticLevel === 0) return;

    if (style === 'selection') {
      Haptics.selectionAsync();
      return;
    }
    if (style === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (style === 'warning') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (style === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    let impactStyle: Haptics.ImpactFeedbackStyle;
    
    if (style === 'light') {
      impactStyle = Haptics.ImpactFeedbackStyle.Light;
    } else if (style === 'medium') {
      impactStyle = Haptics.ImpactFeedbackStyle.Medium;
    } else if (style === 'heavy') {
      impactStyle = Haptics.ImpactFeedbackStyle.Heavy;
    } else if (typeof style === 'number') {
      impactStyle = style;
    } else {
      // Default behavior based on level
      impactStyle = 
        hapticLevel >= 4 ? Haptics.ImpactFeedbackStyle.Heavy :
        hapticLevel >= 2 ? Haptics.ImpactFeedbackStyle.Medium :
        Haptics.ImpactFeedbackStyle.Light;
    }

    Haptics.impactAsync(impactStyle);
  }, [hapticLevel]);

  return (
    <HapticContext.Provider value={{ hapticLevel, setHapticLevel, triggerHaptic }}>
      {children}
    </HapticContext.Provider>
  );
};

export const useHaptics = () => {
  const context = useContext(HapticContext);
  if (!context) {
    throw new Error('useHaptics must be used within a HapticProvider');
  }
  return context;
};
