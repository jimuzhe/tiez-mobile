import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { HapticProvider } from './src/context/HapticContext';

export default function App() {
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
