using System.ComponentModel;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using LamAcars.App.Services;
using LamAcars.Core.Api;

namespace LamAcars.App;

public partial class MainWindow : Window
{
    private readonly AcarsController _controller;

    public MainWindow(AcarsController controller, AppLog log)
    {
        InitializeComponent();
        _controller = controller;
        DataContext = controller;
        foreach (var line in log.Recent) LogList.Items.Add(line);
        log.Line += line => Dispatcher.InvokeAsync(() =>
        {
            LogList.Items.Add(line);
            while (LogList.Items.Count > 300) LogList.Items.RemoveAt(0);
            LogList.ScrollIntoView(line);
        });
    }

    /// <summary>Cerrar la ventana la oculta: el conector sigue en la bandeja.</summary>
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
        base.OnClosing(e);
    }

    private async void Link_Click(object sender, RoutedEventArgs e) => await _controller.LinkAsync();

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await _controller.RefreshAsync();

    private void Update_Click(object sender, RoutedEventArgs e) => _controller.OpenUpdatePage();

    private void EnablePmdg_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("Se agregará [SDK] EnableDataBroadcast=1 a las opciones de tus aviones PMDG (se guarda una copia .lam-backup). " +
                            "Así ACARS lee el freno, el tren, los flaps y la variante directo del avión. ¿Continuar?",
                "LAM ACARS", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            _controller.EnablePmdgSdk();
    }

    private void Unlink_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("Este equipo dejará de enviar vuelos. Revócalo también en la web (Settings → Dispositivos ACARS). ¿Continuar?",
                "LAM ACARS", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            _controller.Unlink();
    }

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        if (FlightList.SelectedItem is not FlightInfo flight)
        {
            MessageBox.Show("Elige un vuelo de la lista.", "LAM ACARS", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (!flight.HasOfp)
        {
            MessageBox.Show("Primero importa el plan de SimBrief en la web (My Flights).", "LAM ACARS", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        try
        {
            await _controller.StartFlightAsync(flight);
        }
        catch (InvalidOperationException ex)
        {
            MessageBox.Show(ex.Message, "No se pudo iniciar", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void Finish_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("¿Terminar el vuelo ahora? Úsalo si ya estás en la posición de llegada.",
                "LAM ACARS", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            _controller.FinishFlight(completed: true);
    }

    private void Abort_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("El vuelo se cancelará y la aeronave quedará disponible. ¿Abandonar?",
                "LAM ACARS", MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes)
            _controller.FinishFlight(completed: false);
    }
}

public sealed class BoolToVisibility : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        (value is true) ^ Invert ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
}

public sealed class StatusBrush : IValueConverter
{
    private static readonly Brush On = new SolidColorBrush(Color.FromRgb(0x2E, 0xC4, 0x8A));
    private static readonly Brush Off = new SolidColorBrush(Color.FromRgb(0xE0, 0xA1, 0x2B));

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value is true ? On : Off;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
}

public sealed class YesNo : IValueConverter
{
    public static readonly YesNo Instance = new();

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value is true ? "sí" : "falta importarlo";

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
}
