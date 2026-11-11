using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Navi
{
    // Navi.exe is the application window. "Navi.exe --overlay" is the floating mini-map.
    // Both show the interface served by the local Navi server, which they start when needed.
    internal static class Program
    {
        internal const string AppTitle = "Navi";
        internal const string OverlayTitle = "Navi — Mini-map";
        internal const string AppMutex = @"Local\NaviCompanionApp";
        internal const string OverlayMutex = @"Local\NaviCompanionOverlay";

        [STAThread]
        static void Main(string[] args)
        {
            bool overlay = args.Contains("--overlay");
            using var mutex = new Mutex(true, overlay ? OverlayMutex : AppMutex, out bool first);
            if (!first)
            {
                var existing = Native.FindWindow(null, overlay ? OverlayTitle : AppTitle);
                if (existing != IntPtr.Zero)
                {
                    Native.ShowWindow(existing, overlay ? 4 : 9); // mini-map: show without taking focus from the game
                    if (overlay) Native.SetWindowPos(existing, new IntPtr(-1), 0, 0, 0, 0, 0x13);
                    else Native.SetForegroundWindow(existing);
                }
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Directory.CreateDirectory(Backend.Profile);
            Application.Run(overlay ? (Form)new OverlayWindow() : new MainWindow());
        }
    }

    // Everything the two windows share: language, the local server, the browser engine.
    internal static class Backend
    {
        internal const string Origin = "http://127.0.0.1:8766";
        internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        internal static readonly string Profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NaviCompanion");
        internal static bool French = LoadLanguage();
        static Process? server;

        static bool LoadLanguage()
        {
            try { var saved = File.ReadAllText(Path.Combine(Profile, "lang.txt")).Trim(); if (saved == "fr" || saved == "en") return saved == "fr"; }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
            return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "fr";
        }

        internal static void SaveLanguage(bool french)
        {
            French = french;
            try { File.WriteAllText(Path.Combine(Profile, "lang.txt"), french ? "fr" : "en"); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        internal static string L(string fr, string en) => French ? fr : en;
        internal static string Language => French ? "fr" : "en";

        internal static async Task<string?> Get(string path)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1.5) };
                using var response = await http.GetAsync(Origin + path);
                return response.IsSuccessStatusCode ? await response.Content.ReadAsStringAsync() : null;
            }
            catch (HttpRequestException) { return null; }
            catch (TaskCanceledException) { return null; }
        }

        // Packaged app: server\navi-server.exe carries its own Python. From sources: an installed Python.
        static Process StartServer()
        {
            var packaged = Path.Combine(Root, "server", "navi-server.exe");
            if (File.Exists(packaged))
            {
                var started = Process.Start(new ProcessStartInfo(packaged, "--no-open --managed") { WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true });
                if (started != null) return started;
            }
            // From sources: Navi.exe built somewhere below the repository (build\shell, for instance).
            var script = Path.Combine(Root, "src", "server.py");
            for (var folder = Directory.GetParent(Root); folder != null && !File.Exists(script); folder = folder.Parent)
                script = Path.Combine(folder.FullName, "src", "server.py");
            if (!File.Exists(script)) throw new FileNotFoundException(L("Le serveur Navi est introuvable : le programme doit rester dans son dossier.", "The Navi server was not found: the program must stay in its folder."));
            script = Path.GetFullPath(script);
            foreach (var (program, option) in new[] { ("pyw.exe", "-3 "), ("pythonw.exe", "") })
            {
                var launch = new ProcessStartInfo(program, option + "\"" + script + "\" --no-open --managed")
                    { WorkingDirectory = Path.GetDirectoryName(Path.GetDirectoryName(script)), UseShellExecute = false, CreateNoWindow = true };
                try { var started = Process.Start(launch); if (started != null) return started; }
                catch (System.ComponentModel.Win32Exception) { }
            }
            throw new InvalidOperationException(L("Python 3 est introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance Navi.", "Python 3 was not found. Install it from https://www.python.org/downloads/ and start Navi again."));
        }

        // Waits until the Navi server answers, starting it on the first miss.
        internal static async Task EnsureServer()
        {
            var deadline = Stopwatch.StartNew();
            while (deadline.Elapsed < TimeSpan.FromSeconds(30))
            {
                var setup = await Get("/api/setup");
                if (setup != null && setup.Contains("\"images\"")) return;
                if (server == null) server = StartServer();
                else if (server.HasExited) throw new InvalidOperationException(L("Le serveur Navi s'est arrêté au démarrage. Le port 8766 est peut-être utilisé par un autre programme.", "The Navi server stopped while starting. Port 8766 may be used by another program."));
                await Task.Delay(250);
            }
            throw new InvalidOperationException(L("Navi ne répond pas. Ferme-le puis relance-le.", "Navi is not responding. Close it and start it again."));
        }

        static bool WindowOpen(string mutexName)
        {
            if (!Mutex.TryOpenExisting(mutexName, out var other)) return false;
            other.Dispose();
            return true;
        }

        // The server stops with the last Navi window. A server started by hand (python src/server.py) is left alone:
        // it only accepts this request when it was started by one of the windows.
        internal static void StopServerIfLastWindow(bool closingOverlay)
        {
            if (WindowOpen(closingOverlay ? Program.AppMutex : Program.OverlayMutex)) return;
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var request = new HttpRequestMessage(HttpMethod.Post, Origin + "/api/quit") { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
                request.Headers.Add("Origin", Origin);
                http.SendAsync(request).Wait(2000);
            }
            catch (Exception) { }
            try { if (server != null && !server.HasExited && !server.WaitForExit(1500)) server.Kill(); }
            catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
        }

        internal static Task<CoreWebView2Environment> Engine() =>
            CoreWebView2Environment.CreateAsync(null, Path.Combine(Profile, "WebView2"), null);

        internal static void Protect(CoreWebView2 core, Func<bool> allowLocalPage)
        {
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            // Guide links open in the default browser; the window itself never leaves Navi.
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
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var url)) { e.Cancel = true; return; }
                bool navi = url.Scheme == "http" && url.Host == "127.0.0.1" && url.Port == 8766;
                bool local = (url.Scheme == "data" || url.Scheme == "about") && allowLocalPage();
                if (!navi && !local) e.Cancel = true;
            };
        }

        internal static string Js(string text)
        {
            var b = new StringBuilder("\"");
            foreach (char ch in text)
            {
                if (ch == '\\' || ch == '"') b.Append('\\').Append(ch);
                else if (ch == '\n') b.Append("\\n");
                else if (ch == '\r') { }
                else if (ch < ' ' || ch == '<' || ch == '>' || ch > '~') b.Append("\\u").Append(((int)ch).ToString("x4"));
                else b.Append(ch);
            }
            return b.Append('"').ToString();
        }

        internal static Rectangle? ReadBounds(string file, int minWidth, int minHeight)
        {
            try
            {
                var parts = File.ReadAllText(Path.Combine(Profile, file)).Trim('[', ']', ' ', '\r', '\n').Split(',').Select(p => int.Parse(p.Trim(), CultureInfo.InvariantCulture)).ToArray();
                if (parts.Length != 4 || parts[2] < minWidth || parts[3] < minHeight || parts[2] > 8000 || parts[3] > 5000) return null;
                var bounds = new Rectangle(parts[0], parts[1], parts[2], parts[3]);
                return Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(bounds.Location, new Size(120, 40)))) ? bounds : (Rectangle?)null;
            }
            catch (IOException) { } catch (UnauthorizedAccessException) { } catch (FormatException) { } catch (OverflowException) { }
            return null;
        }

        internal static void WriteBounds(string file, Rectangle bounds)
        {
            try { File.WriteAllText(Path.Combine(Profile, file), string.Join(",", bounds.Left, bounds.Top, bounds.Width, bounds.Height)); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    // The application window: launch screen first, then the interface.
    internal sealed class MainWindow : Form
    {
        readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(27, 28, 30), Visible = false };
        bool splash = true;
        readonly Shortcuts shortcuts;

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); shortcuts?.HandleCreated(); }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Shortcuts.Message)
            {
                var overlay = Native.FindWindow(null, Program.OverlayTitle);
                if (overlay != IntPtr.Zero) Native.PostMessage(overlay, Shortcuts.Message, m.WParam, IntPtr.Zero);
                else
                    try { Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--overlay") { UseShellExecute = false }); }
                    catch (Exception) { }
                return;
            }
            base.WndProc(ref m);
        }

        public MainWindow()
        {
            shortcuts = new Shortcuts(this);
            Text = Program.AppTitle;
            BackColor = Color.FromArgb(27, 28, 30);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            float dpi = DeviceDpi / 96f;
            MinimumSize = new Size((int)(880 * dpi), (int)(600 * dpi));
            var area = Screen.PrimaryScreen!.WorkingArea;
            Size = new Size(Math.Min(area.Width - 80, (int)(1360 * dpi)), Math.Min(area.Height - 80, (int)(880 * dpi)));
            StartPosition = FormStartPosition.CenterScreen;
            var saved = Backend.ReadBounds("app-window.txt", MinimumSize.Width, MinimumSize.Height);
            // The size of the last session is kept; the window always opens centred, on the screen it was on.
            if (saved.HasValue)
            {
                var screen = Screen.FromRectangle(saved.Value).WorkingArea;
                var size = new Size(Math.Min(saved.Value.Width, screen.Width), Math.Min(saved.Value.Height, screen.Height));
                StartPosition = FormStartPosition.Manual;
                Bounds = new Rectangle(screen.Left + (screen.Width - size.Width) / 2, screen.Top + (screen.Height - size.Height) / 2, size.Width, size.Height);
            }
            Controls.Add(browser);
            Shown += async (_, _) => await Start();
        }

        // Before the browser engine is ready: a plain dark window with the name, never a white flash.
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using var font = new Font("Georgia", 26f);
            using var brush = new SolidBrush(Color.FromArgb(236, 235, 230));
            var size = e.Graphics.MeasureString("NAVI", font);
            e.Graphics.DrawString("NAVI", font, brush, (ClientSize.Width - size.Width) / 2, (ClientSize.Height - size.Height) / 2);
        }

        // Like a game menu: the interface is designed for 1440 x 860 and scaled to the window,
        // so its proportions stay the same at any size.
        // How many screen pixels one page pixel takes at zoom 1 (the display scale), measured from the page itself.
        double displayScale;

        void FitInterface()
        {
            if (IsDisposed || browser.CoreWebView2 == null || WindowState == FormWindowState.Minimized || displayScale <= 0) return;
            double factor = Math.Min(browser.ClientSize.Width / displayScale / 1440.0, browser.ClientSize.Height / displayScale / 860.0);
            if (factor > 0) browser.ZoomFactor = Math.Max(0.4, Math.Min(3.0, factor));
        }

        async Task MeasureDisplay()
        {
            try
            {
                var ratio = double.Parse(await browser.ExecuteScriptAsync("window.devicePixelRatio"), CultureInfo.InvariantCulture);
                if (ratio > 0 && browser.ZoomFactor > 0) displayScale = ratio / browser.ZoomFactor;
            }
            catch (Exception) { }
            FitInterface();
        }

        async Task Status(string text, double? fraction = null)
        {
            if (IsDisposed || browser.CoreWebView2 == null) return;
            try { await browser.ExecuteScriptAsync("window.setStatus&&setStatus(" + Backend.Js(text) + "," + (fraction.HasValue ? fraction.Value.ToString("0.###", CultureInfo.InvariantCulture) : "null") + ")"); }
            catch (Exception) { }
        }

        async Task Start()
        {
            try
            {
                await browser.EnsureCoreWebView2Async(await Backend.Engine());
                var core = browser.CoreWebView2;
                Backend.Protect(core, () => splash);
                core.Settings.IsZoomControlEnabled = false;
                Resize += (_, _) => FitInterface();
                core.NavigationCompleted += async (_, _) => await MeasureDisplay();
                core.WebMessageReceived += (_, e) =>
                {
                    string message; try { message = e.TryGetWebMessageAsString(); } catch (Exception) { return; }
                    if (message == "lang:fr" || message == "lang:en") Backend.SaveLanguage(message == "lang:fr");
                };
                var loaded = new TaskCompletionSource<bool>();
                void Ready(object? s, CoreWebView2NavigationCompletedEventArgs e) => loaded.TrySetResult(true);
                core.NavigationCompleted += Ready;
                core.NavigateToString(Splash.Page(Backend.French));
                await Task.WhenAny(loaded.Task, Task.Delay(4000));
                core.NavigationCompleted -= Ready;
                browser.Visible = true;

                await Status(Backend.L("Démarrage de Navi…", "Starting Navi…"));
                await Backend.EnsureServer();

                // First launch: the game images are fetched once; show how far along it is.
                var waiting = Stopwatch.StartNew();
                while (waiting.Elapsed < TimeSpan.FromMinutes(4))
                {
                    var setup = await Backend.Get("/api/setup") ?? "";
                    var version = Regex.Match(setup, "\"version\":\\s*\"([^\"]*)\"");
                    if (version.Success) { try { await browser.ExecuteScriptAsync("window.setVersion&&setVersion(" + Backend.Js(version.Groups[1].Value) + ")"); } catch (Exception) { } }
                    if (!Regex.IsMatch(setup, "\"active\":\\s*true")) break;
                    int done = int.Parse(Regex.Match(setup, "\"done\":\\s*(\\d+)").Groups[1].Value);
                    int total = Math.Max(1, int.Parse(Regex.Match(setup, "\"total\":\\s*(\\d+)").Groups[1].Value));
                    await Status(Backend.L("Téléchargement des images du jeu · ", "Downloading the game images · ") + done + " / " + total, (double)done / total);
                    await Task.Delay(300);
                }
                await Status(Backend.L("Ouverture de l'atlas…", "Opening the atlas…"), 1);
                await Task.Delay(350);
                splash = false;
                browser.Source = new Uri(Backend.Origin + "/?app=1&lang=" + Backend.Language);
            }
            catch (Exception error)
            {
                if (IsDisposed) return;
                if (browser.CoreWebView2 != null && browser.Visible)
                    try { await browser.ExecuteScriptAsync("window.setError&&setError(" + Backend.Js(error.Message) + ")"); return; } catch (Exception) { }
                browser.Visible = false;
                Controls.Add(new Label { Dock = DockStyle.Fill, Text = error.Message, Padding = new Padding(40), TextAlign = ContentAlignment.MiddleCenter,
                    BackColor = BackColor, ForeColor = Color.FromArgb(236, 235, 230), Font = new Font("Segoe UI", 11) });
                Controls[Controls.Count - 1].BringToFront();
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (WindowState == FormWindowState.Normal) Backend.WriteBounds("app-window.txt", Bounds);
            shortcuts.Dispose();
            browser.Dispose();
            Backend.StopServerIfLastWindow(closingOverlay: false);
            base.OnFormClosed(e);
        }
    }

    // The launch screen, drawn by the browser engine itself so that it matches the interface.
    internal static class Splash
    {
        internal static string Page(bool french) => @"<!doctype html><html lang=""" + (french ? "fr" : "en") + @"""><meta charset=""utf-8""><title>Navi</title><style>
html,body{height:100%;margin:0;background:#1b1c1e;color:#ecebe6;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;user-select:none;cursor:default}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.dial{width:168px;height:168px}
.ring{fill:none;stroke:#3a3c40;stroke-width:1}.inner{fill:none;stroke:#ffffff10;stroke-width:1}
.arc{fill:none;stroke:#c9ab63;stroke-width:2.5;stroke-dasharray:490;stroke-dashoffset:368;transform-origin:100px 100px;animation:turn 2.4s linear infinite}
.medal{fill:#1b1c1e;stroke:#3a3c40;stroke-width:1.2;animation:glow 2.4s ease-in-out infinite}
.medal:nth-of-type(4){animation-delay:.4s}.medal:nth-of-type(5){animation-delay:.8s}.medal:nth-of-type(6){animation-delay:1.2s}.medal:nth-of-type(7){animation-delay:1.6s}.medal:nth-of-type(8){animation-delay:2s}
@keyframes turn{to{transform:rotate(360deg)}}@keyframes glow{0%,100%{fill:#1b1c1e;stroke:#3a3c40}35%{fill:#c9ab63;stroke:#c9ab63}}
h1{margin:0;font:600 44px Georgia,'Times New Roman',serif;letter-spacing:14px;padding-left:14px}
small{display:block;margin-top:8px;text-align:center;font-size:12px;letter-spacing:3px;color:#96989d}
#status{min-height:20px;font-size:14px;color:#96989d;text-align:center;max-width:70%}
#status.error{color:#e3a59a}
.bar{width:300px;height:3px;background:#2a2b2e;overflow:hidden}
.fill{height:100%;width:30%;background:#c9ab63;transition:width .25s ease}
.bar.busy .fill{animation:slide 1.3s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}
#version{position:fixed;bottom:18px;left:0;right:0;text-align:center;font-size:12px;color:#5f6166}
@media (prefers-reduced-motion:reduce){.arc,.medal,.bar.busy .fill{animation:none}}
</style><main>
<svg class=""dial"" viewBox=""0 0 200 200"" aria-hidden=""true""><circle class=""ring"" cx=""100"" cy=""100"" r=""78""/><circle class=""inner"" cx=""100"" cy=""100"" r=""56""/><circle class=""arc"" cx=""100"" cy=""100"" r=""78""/>
<circle class=""medal"" cx=""100"" cy=""22"" r=""9""/><circle class=""medal"" cx=""167.5"" cy=""61"" r=""9""/><circle class=""medal"" cx=""167.5"" cy=""139"" r=""9""/><circle class=""medal"" cx=""100"" cy=""178"" r=""9""/><circle class=""medal"" cx=""32.5"" cy=""139"" r=""9""/><circle class=""medal"" cx=""32.5"" cy=""61"" r=""9""/>
<path d=""M100 76 113 99H87ZM86 101l13 23H73ZM114 101l13 23h-26Z"" fill=""#c9ab63""/></svg>
<div><h1>NAVI</h1><small>OCARINA OF TIME</small></div>
<div id=""status"" role=""status""></div>
<div id=""bar"" class=""bar busy""><div id=""fill"" class=""fill""></div></div>
</main><div id=""version""></div><script>
function setStatus(text,fraction){var s=document.getElementById('status');s.className='';s.textContent=text;var b=document.getElementById('bar'),f=document.getElementById('fill');b.style.visibility='visible';if(fraction===null){b.className='bar busy';f.style.width='30%';}else{b.className='bar';f.style.width=Math.round(Math.max(0,Math.min(1,fraction))*100)+'%';}}
function setError(text){var s=document.getElementById('status');s.className='error';s.textContent=text;document.getElementById('bar').style.visibility='hidden';}
function setVersion(text){document.getElementById('version').textContent='Navi '+text;}
</script></html>";
    }

    // The floating mini-map: borderless, always on top, optionally click-through.
    internal sealed class OverlayWindow : Form
    {
        readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(27, 28, 30) };
        readonly NotifyIcon tray;
        bool locked;
        readonly Shortcuts shortcuts;
        // The shortcuts reach the mini-map directly, or through the application window when it holds them.
        bool ShortcutsWork => shortcuts.Held || Native.FindWindow(null, Program.AppTitle) != IntPtr.Zero;
        protected override bool ShowWithoutActivation => true;
        static string L(string fr, string en) => Backend.L(fr, en);

        public OverlayWindow()
        {
            shortcuts = new Shortcuts(this);
            Text = Program.OverlayTitle;
            TopMost = true;
            ShowInTaskbar = true;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(27, 28, 30);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
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
            var saved = Backend.ReadBounds("window.json", MinimumSize.Width, MinimumSize.Height);
            if (saved.HasValue) Bounds = saved.Value;

            Controls.Add(browser);
            tray = new NotifyIcon { Icon = Icon ?? SystemIcons.Information, Text = L("Navi · Mini-carte", "Navi · Mini-map"), ContextMenuStrip = new ContextMenuStrip(), Visible = true };
            BuildMenu();
            tray.DoubleClick += (_, _) => { SetLocked(false); Show(); };
            Shown += async (_, _) => await InitializeBrowser();
        }

        void BuildMenu()
        {
            var menu = tray.ContextMenuStrip!;
            menu.Items.Clear();
            menu.Items.Add(L("Afficher / masquer · Ctrl+Alt+M", "Show / hide · Ctrl+Alt+M"), null, (_, _) => ToggleVisible());
            menu.Items.Add(L("Verrouiller les clics · Ctrl+Alt+N", "Lock clicks · Ctrl+Alt+N"), null, (_, _) => SetLocked(true));
            menu.Items.Add(L("Déverrouiller la mini-carte", "Unlock the mini-map"), null, (_, _) => { SetLocked(false); Show(); });
            menu.Items.Add(L("Switch to English", "Passer en français"), null, (_, _) => SwitchLanguage());
            menu.Items.Add(L("Fermer", "Close"), null, (_, _) => Close());
        }

        void SwitchLanguage()
        {
            Backend.SaveLanguage(!Backend.French);
            BuildMenu();
            tray.Text = locked ? LockedText() : L("Navi · Mini-carte", "Navi · Mini-map");
            if (browser.CoreWebView2 != null) browser.Source = PageAddress();
        }

        static Uri PageAddress() => new Uri(Backend.Origin + "/?overlay=1&lang=" + Backend.Language);
        string LockedText() => ShortcutsWork ? L("Navi · Verrouillée · Ctrl+Alt+N", "Navi · Locked · Ctrl+Alt+N") : L("Navi · Verrouillée · clic droit ici", "Navi · Locked · right-click here");

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using var frame = new Pen(Color.FromArgb(58, 60, 64));
            using var grip = new Pen(Color.FromArgb(201, 171, 99), 2);
            e.Graphics.DrawRectangle(frame, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
            e.Graphics.DrawLine(grip, ClientSize.Width / 2 - Padding.Top * 2, Padding.Top / 2, ClientSize.Width / 2 + Padding.Top * 2, Padding.Top / 2);
        }

        async Task InitializeBrowser()
        {
            try
            {
                await Backend.EnsureServer();
                await browser.EnsureCoreWebView2Async(await Backend.Engine());
                Backend.Protect(browser.CoreWebView2, () => false);
                browser.CoreWebView2.Settings.IsZoomControlEnabled = false;
                browser.CoreWebView2.DOMContentLoaded += (_, _) => ShowLockOnPage();
                browser.Source = PageAddress();
                if (!ShortcutsWork)
                    tray.ShowBalloonTip(5000, "Navi", L("Un raccourci Ctrl+Alt+N ou Ctrl+Alt+M est déjà pris par un autre programme. Utilise l'icône Navi près de l'horloge pour verrouiller, afficher ou fermer la mini-carte.", "The Ctrl+Alt+N or Ctrl+Alt+M shortcut is already used by another program. Use the Navi icon near the clock to lock, show or close the mini-map."), ToolTipIcon.Info);
            }
            catch (Exception error)
            {
                if (IsDisposed || browser.IsDisposed) return;
                tray.Text = L("Navi · connexion indisponible", "Navi · connection unavailable");
                var message = new Label { Dock = DockStyle.Fill, Text = error.Message, Padding = new Padding(20),
                    BackColor = Color.FromArgb(27, 28, 30), ForeColor = Color.White, Font = new Font("Segoe UI", 11) };
                browser.Controls.Add(message);
            }
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
            tray.Text = value ? LockedText() : L("Navi · Mini-carte", "Navi · Mini-map");
            ShowLockOnPage();
            Native.SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x33);
        }

        // A locked mini-map ignores clicks: the page says so, with the way to unlock it.
        void ShowLockOnPage()
        {
            if (browser.CoreWebView2 == null) return;
            string text = ShortcutsWork ? L("Clics verrouillés · Ctrl+Alt+N pour déverrouiller", "Clicks locked · Ctrl+Alt+N to unlock")
                                        : L("Clics verrouillés · icône Navi près de l'horloge", "Clicks locked · Navi icon near the clock");
            string script = locked ? "document.body.setAttribute('data-locked'," + Backend.Js(text) + ")"
                                   : "document.body.removeAttribute('data-locked')";
            try { _ = browser.CoreWebView2.ExecuteScriptAsync(script); } catch (Exception) { }
        }

        void ToggleVisible() { if (Visible) Hide(); else { Show(); TopMost = true; } }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            shortcuts?.HandleCreated();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Shortcuts.Message)
            {
                if (m.WParam.ToInt32() == Shortcuts.Lock) SetLocked(!locked);
                if (m.WParam.ToInt32() == Shortcuts.Toggle) ToggleVisible();
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

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            shortcuts.Dispose();
            tray.Dispose();
            Backend.WriteBounds("window.json", Bounds);
            browser.Dispose();
            Backend.StopServerIfLastWindow(closingOverlay: true);
            base.OnFormClosed(e);
        }
    }

    // Ctrl+Alt+N (lock clicks) and Ctrl+Alt+M (show / hide) act on the mini-map from anywhere, the game included.
    // Windows gives a shortcut to one window only: whichever Navi window got it passes it on, and the other
    // one keeps asking so that it takes over when the first is closed.
    internal sealed class Shortcuts : IDisposable
    {
        internal const int Message = 0x312, Lock = 1, Toggle = 2;
        readonly Form owner;
        readonly System.Windows.Forms.Timer retry = new System.Windows.Forms.Timer { Interval = 2000 };
        bool lockKey, toggleKey;

        internal Shortcuts(Form owner)
        {
            this.owner = owner;
            retry.Tick += (_, _) => Register();
            retry.Start();
        }

        internal bool Held => lockKey && toggleKey;

        // The window handle is new (first display, or recreated by Windows Forms): earlier registrations died with the old one.
        internal void HandleCreated() { lockKey = toggleKey = false; Register(); }

        void Register()
        {
            if (!owner.IsHandleCreated || owner.IsDisposed) return;
            if (!lockKey) lockKey = Native.RegisterHotKey(owner.Handle, Lock, 0x4003, (uint)Keys.N); // Ctrl+Alt, no repeat
            if (!toggleKey) toggleKey = Native.RegisterHotKey(owner.Handle, Toggle, 0x4003, (uint)Keys.M);
        }

        public void Dispose()
        {
            retry.Dispose();
            if (!owner.IsHandleCreated) return;
            if (lockKey) Native.UnregisterHotKey(owner.Handle, Lock);
            if (toggleKey) Native.UnregisterHotKey(owner.Handle, Toggle);
        }
    }

    internal static class Native
    {
        [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr FindWindow(string? className, string title);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
        [DllImport("user32.dll")] internal static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
        [DllImport("user32.dll")] internal static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint color, byte alpha, uint flags);
        [DllImport("user32.dll")] internal static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
        [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    }
}
