using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    internal const string WindowTitle = "Navi — Mini-carte";
    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, @"Local\NaviCompanionOverlay", out bool first);
        if (!first)
        {
            var existing = Native.FindWindow(null, WindowTitle);
            if (existing != IntPtr.Zero)
            {
                Native.ShowWindow(existing, 4); // Show without taking focus from the game.
                Native.SetWindowPos(existing, new IntPtr(-1), 0, 0, 0, 0, 0x13);
            }
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new OverlayWindow());
    }
}

internal sealed class OverlayWindow : Form
{
    readonly WebView2 browser = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(17, 26, 35) };
    readonly NotifyIcon tray;
    readonly string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NaviCompanion");
    bool locked, lockHotkey, hideHotkey;
    Process? server;
    protected override bool ShowWithoutActivation => true;

    public OverlayWindow()
    {
        Text = Program.WindowTitle;
        TopMost = true;
        ShowInTaskbar = true;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(20, 30, 40);
        // The slim top edge is a drag handle; no title bar covers the map.
        float dpi = DeviceDpi / 96f;
        int edge = (int)Math.Round(5 * dpi);
        Padding = new Padding(edge, (int)Math.Round(10 * dpi), edge, edge);
        DoubleBuffered = true;
        ResizeRedraw = true;
        MinimumSize = new Size((int)(360 * dpi), (int)(320 * dpi));
        Size = new Size((int)(500 * dpi), (int)(540 * dpi));
        StartPosition = FormStartPosition.Manual;
        var screen = Screen.PrimaryScreen!.WorkingArea;
        Location = new Point(screen.Right - Width - 24, screen.Bottom - Height - 24);
        Directory.CreateDirectory(profile);
        RestoreBoundsFromFile();

        Controls.Add(browser);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Afficher / masquer · Ctrl+Alt+M", null, (_, _) => ToggleVisible());
        menu.Items.Add("Verrouiller les clics · Ctrl+Alt+N", null, (_, _) => SetLocked(true));
        menu.Items.Add("Déverrouiller la mini-carte", null, (_, _) => { SetLocked(false); Show(); });
        menu.Items.Add("Fermer", null, (_, _) => Close());
        tray = new NotifyIcon { Icon = SystemIcons.Information, Text = "Navi · Mini-carte", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (_, _) => { SetLocked(false); Show(); };
        Shown += async (_, _) => await InitializeBrowser();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var frame = new Pen(Color.FromArgb(120, 108, 80));
        using var grip = new Pen(Color.FromArgb(216, 183, 110), 2);
        e.Graphics.DrawRectangle(frame, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        e.Graphics.DrawLine(grip, ClientSize.Width / 2 - Padding.Top * 2, Padding.Top / 2, ClientSize.Width / 2 + Padding.Top * 2, Padding.Top / 2);
    }

    async Task InitializeBrowser()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            bool ready = false;
            var deadline = Stopwatch.StartNew();
            while (deadline.Elapsed < TimeSpan.FromSeconds(20))
            {
                try { using var response = await http.GetAsync("http://127.0.0.1:8766/"); ready = response.IsSuccessStatusCode && (await response.Content.ReadAsStringAsync()).Contains("Navi"); } catch (HttpRequestException) { } catch (TaskCanceledException) { }
                if (ready) break;
                if (server == null) server = StartServer();
                else if (server.HasExited) throw new InvalidOperationException("Le serveur Navi s'est arrêté au démarrage. Le port 8766 est peut-être utilisé par un autre programme : lance Lancer-Navi.cmd pour voir le détail.");
                await Task.Delay(250);
            }
            if (!ready) throw new InvalidOperationException("Navi ne répond pas. Lance Lancer-Navi.cmd puis rouvre la mini-carte.");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(profile, "WebView2"));
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var link) && link.Scheme == Uri.UriSchemeHttps)
                    try { Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true }); }
                    catch (System.ComponentModel.Win32Exception) { }
            };
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var url) || url.Scheme != "http" || url.Host != "127.0.0.1" || url.Port != 8766)
                    e.Cancel = true;
            };
            browser.Source = new Uri("http://127.0.0.1:8766/?overlay=1");
            if (!lockHotkey || !hideHotkey)
                tray.ShowBalloonTip(5000, "Navi", "Un raccourci Ctrl+Alt+N ou Ctrl+Alt+M est déjà pris par un autre programme. Utilise l'icône Navi près de l'horloge pour verrouiller, afficher ou fermer la mini-carte.", ToolTipIcon.Info);
        }
        catch (Exception error)
        {
            if (IsDisposed || browser.IsDisposed) return;
            tray.Text = "Navi · connexion indisponible";
            var message = new Label { Dock = DockStyle.Fill, Text = error.Message, Padding = new Padding(20),
                BackColor = Color.FromArgb(17, 26, 35), ForeColor = Color.White, Font = new Font("Segoe UI", 11) };
            browser.Controls.Add(message);
        }
    }

    // Starts the local server without a console window. The Python launcher is tried
    // first: it exists even when Python was installed without being added to PATH.
    static Process StartServer()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
        var script = Path.Combine(root, "server.py");
        if (!File.Exists(script)) throw new FileNotFoundException("Le serveur Navi est introuvable : le dossier overlay-app doit rester dans le dossier de Navi.");
        foreach (var (program, option) in new[] { ("pyw.exe", "-3"), ("pythonw.exe", null as string) })
        {
            var launch = new ProcessStartInfo(program) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
            if (option != null) launch.ArgumentList.Add(option);
            launch.ArgumentList.Add(script);
            try { if (Process.Start(launch) is Process started) return started; }
            catch (System.ComponentModel.Win32Exception) { }
        }
        throw new InvalidOperationException("Python 3 est introuvable. Installe-le depuis https://www.python.org/downloads/ puis rouvre la mini-carte.");
    }

    void SetLocked(bool value)
    {
        // Click-through can always be undone from the tray icon, even without the shortcut.
        locked = value;
        long style = Native.GetWindowLongPtr(Handle, -20).ToInt64();
        const long transparent = 0x20, layered = 0x80000, noActivate = 0x8000000;
        style = value ? style | transparent | layered | noActivate : style & ~(transparent | noActivate);
        Native.SetWindowLongPtr(Handle, -20, new IntPtr(style));
        if (value) Native.SetLayeredWindowAttributes(Handle, 0, 255, 2);
        tray.Text = value ? (lockHotkey ? "Navi · Verrouillée · Ctrl+Alt+N" : "Navi · Verrouillée · clic droit ici") : "Navi · Mini-carte";
        Native.SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x33);
    }

    void ToggleVisible() { if (Visible) Hide(); else { Show(); TopMost = true; } }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        lockHotkey = Native.RegisterHotKey(Handle, 1, 0x4003, (uint)Keys.N); // Ctrl+Alt, no repeat
        hideHotkey = Native.RegisterHotKey(Handle, 2, 0x4003, (uint)Keys.M);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x312)
        {
            if (m.WParam.ToInt32() == 1) SetLocked(!locked);
            if (m.WParam.ToInt32() == 2) ToggleVisible();
            return;
        }
        if (m.Msg == 0x84 && !locked)
        {
            long packed = m.LParam.ToInt64();
            Point p = PointToClient(new Point((short)(packed & 0xFFFF), (short)((packed >> 16) & 0xFFFF)));
            // The web view covers everything inside the padding, so the padding is the grab area.
            int border = Padding.Left, corner = Padding.Top * 2;
            bool left = p.X < border, right = p.X >= ClientSize.Width - border;
            bool top = p.Y < Padding.Top, bottom = p.Y >= ClientSize.Height - border;
            if (top || bottom) { left = p.X < corner; right = p.X >= ClientSize.Width - corner; }
            // Corners resize; the full slim upper edge moves the window (HTCAPTION).
            int hit = top && left ? 13 : top && right ? 14 : bottom && left ? 16 : bottom && right ? 17 : left ? 10 : right ? 11 : top ? 2 : bottom ? 15 : 0;
            if (hit != 0) { m.Result = new IntPtr(hit); return; }
        }
        base.WndProc(ref m);
    }

    void RestoreBoundsFromFile()
    {
        try
        {
            var box = JsonSerializer.Deserialize<int[]>(File.ReadAllText(Path.Combine(profile, "window.json")));
            if (box?.Length != 4 || box[2] < 360 || box[3] < 320 || box[2] > 3000 || box[3] > 2000) return;
            var bounds = new Rectangle(box[0], box[1], box[2], box[3]);
            if (Screen.AllScreens.Any(s => s.WorkingArea.Contains(new Rectangle(bounds.Location, new Size(100, 38))))) Bounds = bounds;
        }
        catch (IOException) { } catch (JsonException) { } catch (UnauthorizedAccessException) { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        if (lockHotkey) Native.UnregisterHotKey(Handle, 1);
        if (hideHotkey) Native.UnregisterHotKey(Handle, 2);
        tray.Dispose();
        try { File.WriteAllText(Path.Combine(profile, "window.json"), JsonSerializer.Serialize(new[] { Left, Top, Width, Height })); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        browser.Dispose();
        // Stop the server only when this window started it; one launched by Lancer-Navi.cmd keeps running.
        try { if (server is { HasExited: false }) server.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
        base.OnFormClosed(e);
    }
}

internal static class Native
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr FindWindow(string? className, string title);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] internal static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")] internal static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint color, byte alpha, uint flags);
    [DllImport("user32.dll")] internal static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
