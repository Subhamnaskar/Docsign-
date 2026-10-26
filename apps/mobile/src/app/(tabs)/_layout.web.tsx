import { Tabs } from 'expo-router';
import { type ColorValue, Text } from 'react-native';
import { useTheme } from '@/lib/theme';

/** Browser previews: native tabs exist only on phones, so a web tab bar stands in. */
export default function TabsLayout() {
  const t = useTheme();
  const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.primary, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="to-sign" options={{ title: 'To sign', tabBarIcon: icon('✎') }} />
      <Tabs.Screen name="agreements" options={{ title: 'Agreements', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
