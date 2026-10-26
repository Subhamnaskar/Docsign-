import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.primary} backgroundColor={t.card} labelStyle={{ selected: { color: t.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="to-sign">
        <NativeTabs.Trigger.Label>To sign</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="signature" md="draw" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agreements">
        <NativeTabs.Trigger.Label>Agreements</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} md="description" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
