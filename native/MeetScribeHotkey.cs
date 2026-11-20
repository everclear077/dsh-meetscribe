using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class MeetScribeHotkey
{
    private const int HotkeyId = 0x4d53;
    private const uint ModControl = 0x0002;
    private const uint ModNoRepeat = 0x4000;
    private const uint KeyE = 0x45;
    private const uint KeyControl = 0x11;
    private const uint KeyEventKeyUp = 0x0002;
    private const int SwRestore = 9;

    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] private static extern bool GetMessage(out Message message, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    [STAThread]
    private static void Main()
    {
        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\dsh-meetscribe-ctrl-e", out ownsMutex))
        {
            if (!ownsMutex) return;
            if (!RegisterHotKey(IntPtr.Zero, HotkeyId, ModControl | ModNoRepeat, KeyE))
            {
                File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-meetscribe-hotkey-error.log"),
                    DateTime.Now.ToString("s") + " Ctrl+E is already registered by another application. Change or close the conflicting application.\r\n");
                return;
            }
            try
            {
                Message message;
                while (GetMessage(out message, IntPtr.Zero, 0, 0))
                {
                    if (message.Msg != 0x0312 || message.WParam.ToInt32() != HotkeyId) continue;
                    foreach (var name in new[] { "DeepSeek Harness", "DeepSeekHarness" })
                    {
                        foreach (var process in Process.GetProcessesByName(name))
                        {
                            if (process.MainWindowHandle == IntPtr.Zero) continue;
                            ShowWindow(process.MainWindowHandle, SwRestore);
                            BringWindowToTop(process.MainWindowHandle);
                            SwitchToThisWindow(process.MainWindowHandle, true);
                            SetForegroundWindow(process.MainWindowHandle);
                            Thread.Sleep(100);
                            // Do not intercept our own synthetic Ctrl+E and feed it back
                            // to this message loop instead of the Harness window.
                            UnregisterHotKey(IntPtr.Zero, HotkeyId);
                            keybd_event((byte)KeyControl, 0, 0, UIntPtr.Zero);
                            keybd_event((byte)KeyE, 0, 0, UIntPtr.Zero);
                            keybd_event((byte)KeyE, 0, KeyEventKeyUp, UIntPtr.Zero);
                            keybd_event((byte)KeyControl, 0, KeyEventKeyUp, UIntPtr.Zero);
                            Thread.Sleep(100);
                            if (!RegisterHotKey(IntPtr.Zero, HotkeyId, ModControl | ModNoRepeat, KeyE))
                            {
                                File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-meetscribe-hotkey-error.log"),
                                    DateTime.Now.ToString("s") + " Ctrl+E could not be restored after invoking Harness.\r\n");
                                return;
                            }
                            break;
                        }
                    }
                }
            }
            finally { UnregisterHotKey(IntPtr.Zero, HotkeyId); }
        }
    }
}
