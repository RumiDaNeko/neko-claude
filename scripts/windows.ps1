# Prints the visible top-level windows (front to back) about eight times a second, one JSON line per scan,
# so claude-chan can perch on title bars. Rects are physical pixels (DWM visual bounds).
# The last field is 1 for windows of the Claude desktop app (she checks for it after you confess to using ChatGPT).
param([int]$SelfPid = 0)
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ChanWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  // process id -> is it Claude.exe (looked up once per process)
  static Dictionary<uint, bool> claudePids = new Dictionary<uint, bool>();
  static int IsClaude(uint pid) {
    bool v;
    if (!claudePids.TryGetValue(pid, out v)) {
      try { v = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.Equals("claude", StringComparison.OrdinalIgnoreCase); } catch { v = false; }
      claudePids[pid] = v;
    }
    return v ? 1 : 0;
  }
  public static string Scan(int self) {
    var sb = new StringBuilder("[");
    IntPtr fg = GetForegroundWindow();
    int n = 0;
    EnumWindows((h, p) => {
      if (n >= 40 || !IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == self) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Shell_TrayWnd" || c == "Progman" || c == "WorkerW") return true;
      // minimised: reported with a flag (no usable rect), so she can tell it from a closed window
      if (IsIconic(h)) {
        if (n > 0) sb.Append(',');
        sb.Append('[').Append(h.ToInt64()).Append(",0,0,0,0,0,0,1,").Append(IsClaude(pid)).Append(']');
        n++;
        return true;
      }
      RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true;
      if (r.R - r.L < 120 || r.B - r.T < 80) return true;
      if (n > 0) sb.Append(',');
      sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R).Append(',').Append(r.B)
        .Append(',').Append(IsZoomed(h) ? 1 : 0).Append(',').Append(h == fg ? 1 : 0).Append(",0,").Append(IsClaude(pid)).Append(']');
      n++;
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
"@
while ($true) {
  [Console]::Out.WriteLine([ChanWin]::Scan($SelfPid))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 120
}
