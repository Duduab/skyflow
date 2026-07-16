import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Colors,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  SubTitle,
  Title,
  Tooltip,
} from 'chart.js';

/**
 * Registers only the Chart.js pieces the admin charts actually use
 * (line, bar, doughnut). Importing this module from a lazy admin component
 * keeps the whole chart.js bundle inside that lazy chunk — out of the initial
 * payload — while avoiding the heavier `withDefaultRegisterables()`.
 *
 * Registration runs once as a module side-effect (Chart.register is idempotent
 * for already-registered items).
 */
Chart.register(
  // controllers
  LineController,
  BarController,
  DoughnutController,
  // elements
  LineElement,
  PointElement,
  BarElement,
  ArcElement,
  // scales
  CategoryScale,
  LinearScale,
  // plugins
  Tooltip,
  Legend,
  Filler,
  Title,
  SubTitle,
  Colors,
);
