import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { HapticProvider } from './src/context/HapticContext';
import { checkForUpdatesOnLaunch } from './src/lib/updateChecker';

export default function App() {
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdatesOnLaunch();
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ThemeProvider>
      <HapticProvider>
        <SafeAreaProvider>
          <AppNavigator />
        </SafeAreaProvider>
      </HapticProvider>
    </ThemeProvider>
  );
}
