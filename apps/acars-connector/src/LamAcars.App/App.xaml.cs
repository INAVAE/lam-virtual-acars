using System.Threading;
using System.Windows;
using LamAcars.App.Services;
using Forms = System.Windows.Forms;

namespace LamAcars.App;

public partial class App : Application
{
    private Mutex? _single;
    private Forms.NotifyIcon? _tray;
    private AcarsController? _controller;
    private MainWindow? _window;
    private readonly AppLog _log = new();

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _single = new Mutex(true, "LamAcars.Connector.SingleInstance", out var first);
        if (!first)
        {
            MessageBox.Show("LAM ACARS ya está abierto. Búscalo junto al reloj de Windows.", "LAM ACARS", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            _log.Write($"Error inesperado: {args.Exception.Message}");
            args.Handled = true;
        };

        _controller = new AcarsController(_log);
        _controller.QuitForUpdate += () => Dispatcher.Invoke(() => Quit(force: true));
        _window = new MainWindow(_controller, _log);
        _window.Show();
        CreateTray();
        await _controller.StartAsync();
    }

    private void CreateTray()
    {
        var iconStream = GetResourceStream(new Uri("pack://application:,,,/Assets/lam.ico"))?.Stream;
        _tray = new Forms.NotifyIcon
        {
            Icon = iconStream is null ? System.Drawing.SystemIcons.Application : new System.Drawing.Icon(iconStream),
            Text = "LAM ACARS",
            Visible = true,
            ContextMenuStrip = new Forms.ContextMenuStrip(),
        };
        _tray.ContextMenuStrip.Items.Add("Abrir LAM ACARS", null, (_, _) => ShowWindow());
        var onTop = new Forms.ToolStripMenuItem("Siempre visible") { CheckOnClick = true, Checked = _controller?.AlwaysOnTop ?? false };
        onTop.CheckedChanged += (_, _) =>
        {
            if (_controller is null) return;
            _controller.AlwaysOnTop = onTop.Checked;
            if (onTop.Checked) ShowWindow();
        };
        _controller!.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(AcarsController.AlwaysOnTop) && onTop.Checked != _controller.AlwaysOnTop)
                onTop.Checked = _controller.AlwaysOnTop;
        };
        _tray.ContextMenuStrip.Items.Add(onTop);
        _tray.ContextMenuStrip.Items.Add("Salir", null, (_, _) => Quit());
        _tray.DoubleClick += (_, _) => ShowWindow();
    }

    public void ShowWindow()
    {
        if (_window is null) return;
        _window.Show();
        if (_window.WindowState == WindowState.Minimized) _window.WindowState = WindowState.Normal;
        _window.Activate();
    }

    public void Quit(bool force = false)
    {
        if (!force && _controller?.InFlight == true &&
            MessageBox.Show("Hay un vuelo en curso. Si sales, ACARS deja de registrarlo hasta que vuelvas a abrir el conector (el vuelo se reanuda). ¿Salir?",
                "LAM ACARS", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;
        _tray?.Dispose();
        _controller?.Dispose();
        _single?.ReleaseMutex();
        Shutdown();
    }
}
