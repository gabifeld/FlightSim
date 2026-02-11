// Physics
export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225; // kg/m³ at sea level
export const WING_AREA = 25; // m²
export const MASS = 1200; // kg
export const MAX_THRUST = 18000; // N

// Lift / Drag
export const CL_BASE = 0.4;
export const CL_SLOPE = 5.5; // per radian
export const CL_FLAP_BONUS = 0.8;
export const CD_PARASITIC = 0.02;
export const CD_INDUCED_FACTOR = 0.05;
export const CD_GEAR_PENALTY = 0.015;
export const CD_FLAP_PENALTY = 0.06;
export const CD_SPEEDBRAKE_PENALTY = 0.08;
export const STALL_AOA = 28 * (Math.PI / 180); // 28 degrees in radians

// Aircraft control rates (rad/s)
export const PITCH_RATE = 1.0;
export const ROLL_RATE = 1.6;
export const YAW_RATE = 0.5;
export const THROTTLE_RATE = 0.6; // per second

// Speeds
export const TAKEOFF_SPEED = 60; // m/s
export const STALL_SPEED = 45; // m/s

// Ground handling
export const GROUND_FRICTION = 0.03;
export const BRAKE_FRICTION = 0.4;
export const MAX_LANDING_VS = 3.0; // m/s vertical
export const MAX_LANDING_SPEED = 80; // m/s

// Terrain
export const TERRAIN_SIZE = 50000; // meters
export const TERRAIN_SEGMENTS = 384;
export const TERRAIN_MAX_HEIGHT = 400; // meters

// Runway
export const RUNWAY_LENGTH = 2000; // meters
export const RUNWAY_WIDTH = 45; // meters
export const RUNWAY_FLATTEN_RADIUS = 300; // transition zone

// Second airport position
export const AIRPORT2_X = 8000;
export const AIRPORT2_Z = -8000;

// Camera
export const CHASE_DISTANCE = 14;
export const CHASE_HEIGHT = 10;
export const CHASE_LERP_SPEED = 3.0;
export const COCKPIT_OFFSET_Y = 2.0;
export const COCKPIT_OFFSET_Z = -2.0;
export const CAMERA_FAR = 80000;

// Conversions
export const MS_TO_KNOTS = 1.94384;
export const M_TO_FEET = 3.28084;
export const MS_TO_FPM = 196.85; // m/s to ft/min

// Banking / turning
export const BANK_TO_YAW = 0.3; // how much roll couples into yaw
export const ADVERSE_YAW = 0.01; // roll input creates opposite yaw
export const YAW_DAMPING = 0.8; // sideslip damping (weathervane effect)
export const ROLL_DAMPING = 0.12; // damps roll when no input
export const PITCH_DAMPING = 0.04; // damps pitch when no input (low = holds attitude)

// Stall
export const STALL_SEVERITY = 1.2; // how sharply lift drops past stall
export const STALL_ROLL_RATE = 0.5; // wing drop rate during stall (rad/s)

// Turn physics
export const TURN_DRAG_FACTOR = 0.08; // extra induced drag per G of load factor

// Delta time
export const MAX_DT = 0.05; // 50ms clamp

// Weather
export const DEFAULT_WIND_SPEED = 1.5; // m/s (light breeze)
export const DEFAULT_WIND_DIRECTION = Math.PI; // from west
export const DEFAULT_TURBULENCE = 0.02;
export const GUST_MIN_INTERVAL = 5; // seconds
export const GUST_MAX_INTERVAL = 15;
export const GUST_DECAY_RATE = 2.0;

// Ground effect
export const GROUND_EFFECT_WINGSPAN = 14; // meters
export const GROUND_EFFECT_DRAG_REDUCTION = 0.5; // 50% induced drag reduction
export const GROUND_EFFECT_LIFT_BONUS = 0.1; // 10% lift increase

// Camera shake
export const TURBULENCE_SHAKE_INTENSITY = 0.15;
export const LANDING_SHAKE_DECAY_RATE = 8.0;
export const CAMERA_TRANSITION_DURATION = 0.33; // seconds

// Taxi
export const TAXI_SPEED_LIMIT = 15.4; // 30 knots in m/s

// Time of day
export const DEFAULT_TIME_OF_DAY = 12.0; // noon
export const TIME_CYCLE_RATE = 1.0; // hours per 60 real seconds

// City
export const CITY_CENTER_X = 4000;
export const CITY_CENTER_Z = -4000;
export const CITY_SIZE = 2000;

// Coastline / Ocean
export const COAST_LINE_X = 13000; // x-coordinate where coastline runs
export const OCEAN_DEPTH = 40; // max depth below sea level
export const COAST_MARGIN = 800; // transition zone width
export const BEACH_CENTER_Z = -2000; // z-center of the main beach area
export const SEAPLANE_X = 15000; // seaplane position (well past coastline + noise)
export const SEAPLANE_Z = -2000;
