
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Modal,
  Animated,
  useWindowDimensions,
  AppState,
} from 'react-native';

import { supabase } from './lib/supabase';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';

type RideType = 'motorcycle' | 'tricycle' | null;
type BookingType = 'delivery' | 'ride' | null;
type UserRole = 'passenger' | 'driver';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashLogoOpacity = useRef(new Animated.Value(0)).current;
  const splashLogoScale = useRef(new Animated.Value(0.9)).current;
  const splashCircleScale = useRef(new Animated.Value(0.025)).current;
  const { width: splashWidth, height: splashHeight } = useWindowDimensions();
  const splashCircleDiameter = Math.ceil(Math.hypot(splashWidth, splashHeight)) + 40;
  const [isLogin, setIsLogin] = useState(true);
  const [signupRole, setSignupRole] = useState<UserRole>('passenger');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('passenger');
  const [driverRecord, setDriverRecord] = useState<any>(null);
  const [driverBookings, setDriverBookings] = useState<any[]>([]);
  const [driverActiveTrips, setDriverActiveTrips] = useState<any[]>([]);
  const [currentTripStatus, setCurrentTripStatus] = useState<string>('pending');
  const [driverVehicle, setDriverVehicle] = useState<string | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);
  const [driverBusy, setDriverBusy] = useState(false);
  const [driverError, setDriverError] = useState('');
  const [driverGpsStatus, setDriverGpsStatus] = useState('Not sharing location');
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  // Expand a small navy circle to cover the screen, then reveal the original logo.
  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.delay(180),
      Animated.timing(splashCircleScale, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(splashLogoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(splashLogoScale, { toValue: 1, friction: 8, tension: 45, useNativeDriver: true }),
      ]),
      Animated.delay(550),
      Animated.timing(splashOpacity, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);
    sequence.start(({ finished }) => { if (finished) setShowSplash(false); });
    return () => sequence.stop();
  }, [splashCircleScale, splashOpacity, splashLogoOpacity, splashLogoScale]);

  const [selectedRide, setSelectedRide] = useState<RideType>(null);
  const [bookingType, setBookingType] = useState<BookingType>(null);
  const [screen, setScreen] = useState<'home' | 'map' | 'tracking' | 'history' | 'profile'>('home');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'COD' | null>(null);
  // The interactive map starts in Naval, Biliran. GPS is optional.
  const mapRef = useRef<MapView>(null);
  const [userCoordinates, setUserCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  type MapPoint = { latitude: number; longitude: number };
  const [pickupPoint, setPickupPoint] = useState<MapPoint | null>(null);
  const [dropoffPoint, setDropoffPoint] = useState<MapPoint | null>(null);
  const [selectingPoint, setSelectingPoint] = useState<'pickup' | 'dropoff' | null>(null);

  function startPointSelection(kind: 'pickup' | 'dropoff') {
    setSelectingPoint(kind);
    setSheetExpanded(false);
    Animated.timing(sheetProgress, {
      toValue: 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }

  function onMapPointPress(event: MapPressEvent) {
    if (!selectingPoint) return;
    const { latitude, longitude } = event.nativeEvent.coordinate;
    const point = { latitude, longitude };
    const description = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    if (selectingPoint === 'pickup') {
      setPickupPoint(point);
      setPickup(description);
    } else {
      setDropoffPoint(point);
      setDropoff(description);
    }
    setSelectingPoint(null);
    setPreviewFare(null);
    setSheetExpanded(true);
    Animated.timing(sheetProgress, {
      toValue: 1,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }

  const initialMapRegion: Region = {
    latitude: 11.5605,
    longitude: 124.3970,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
  };

  async function centerOnMyLocation() {
    if (gpsLoading) return;
    setGpsLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Location permission', 'Allow location access in your phone settings to center the map on your position. You can still browse the map without GPS.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setUserCoordinates(coordinates);
      mapRef.current?.animateToRegion({ ...coordinates, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 700);
    } catch (error: any) {
      Alert.alert('GPS unavailable', error?.message || 'Unable to get your location. Please check that Location is enabled.');
    } finally {
      setGpsLoading(false);
    }
  }

  // Road-distance and fare preview; the server independently verifies them when booking.
  const [previewFare, setPreviewFare] = useState<number | null>(null);
  const [roadDistanceKm, setRoadDistanceKm] = useState<number | null>(null);
  const [roadDurationMinutes, setRoadDurationMinutes] = useState<number | null>(null);
  const [routeError, setRouteError] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const routeRequestId = useRef(0);
  // Recalculate when either map pin or the selected vehicle changes.
  // Ignore results from older requests if the passenger moves a pin mid-request.
  useEffect(() => {
    const requestId = ++routeRequestId.current;
    setRoadDistanceKm(null);
    setRoadDurationMinutes(null);
    setPreviewFare(null);
    setRouteError('');
    setRouteLoading(false);

    if (!loggedIn || userRole !== 'passenger' || !pickupPoint || !dropoffPoint || !selectedRide) return;

    const timer = setTimeout(async () => {
      if (requestId !== routeRequestId.current) return;
      setRouteLoading(true);
      try {
        const { data: route, error: routeFailure } = await supabase.functions.invoke('calculate-route', {
          body: { pickup: pickupPoint, dropoff: dropoffPoint },
        });
        if (routeFailure) throw routeFailure;
        if (route?.error) throw new Error(String(route.error));
        const km = Number(route?.distance_km);
        const minutes = Number(route?.duration_minutes);
        if (!Number.isFinite(km) || km <= 0) throw new Error('No valid road route was returned.');
        const { data: fareData, error: fareFailure } = await supabase.rpc('calculate_ride_fare', {
          p_vehicle_type: selectedRide,
          p_distance_km: km,
        });
        if (fareFailure) throw fareFailure;
        const fare = Number(fareData);
        if (!Number.isFinite(fare) || fare < 0) throw new Error('Invalid fare returned.');
        if (requestId !== routeRequestId.current) return;
        setRoadDistanceKm(km);
        setRoadDurationMinutes(Number.isFinite(minutes) && minutes >= 0 ? minutes : null);
        setPreviewFare(fare);
      } catch (error: any) {
        if (requestId !== routeRequestId.current) return;
        setRouteError(error?.message || 'Could not calculate the route. Please try again.');
      } finally {
        if (requestId === routeRequestId.current) setRouteLoading(false);
      }
    }, 400);
    return () => { clearTimeout(timer); ++routeRequestId.current; };
  }, [loggedIn, userRole, pickupPoint?.latitude, pickupPoint?.longitude, dropoffPoint?.latitude, dropoffPoint?.longitude, selectedRide]);

  const [matchStage, setMatchStage] = useState<'none' | 'searching' | 'found'>('none');
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [assignedDriver, setAssignedDriver] = useState<{ name: string; vehicle: string; plate: string } | null>(null);
  const [assignedDriverId, setAssignedDriverId] = useState<string | null>(null);
  const [driverLivePoint, setDriverLivePoint] = useState<MapPoint | null>(null);
  const [driverLocationUpdatedAt, setDriverLocationUpdatedAt] = useState<string | null>(null);
  const [driverLocationError, setDriverLocationError] = useState('');
  const [locationClock, setLocationClock] = useState(Date.now());
  const trackingMapRef = useRef<MapView>(null);
  const LIVE_LOCATION_MAX_AGE_MS = 45000;
  const driverLocationAgeMs = driverLocationUpdatedAt ? locationClock - Date.parse(driverLocationUpdatedAt) : Infinity;
  const driverLocationFresh = !!driverLivePoint && Number.isFinite(driverLocationAgeMs) && driverLocationAgeMs >= 0 && driverLocationAgeMs <= LIVE_LOCATION_MAX_AGE_MS;

  const [matchError, setMatchError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookings, setBookings] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);
  const bookingSubmitting = useRef(false);
  const [historyError, setHistoryError] = useState('');
  const pulse = useRef(new Animated.Value(0)).current;
  const { height: windowHeight } = useWindowDimensions();
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const sheetProgress = useRef(new Animated.Value(1)).current;
  const expandedSheetHeight = Math.min(490, Math.max(320, windowHeight * 0.63));
  const sheetHeight = sheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [78, expandedSheetHeight],
  });

  // Ask for foreground GPS only when the passenger opens the map.
  useEffect(() => {
    if (loggedIn && userRole === 'passenger' && screen === 'map') {
      void centerOnMyLocation();
    }
    // Run on screen entry, not whenever GPS/loading state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, userRole, screen]);

  function toggleMapSheet() {
    const next = !sheetExpanded;
    setSheetExpanded(next);
    Animated.timing(sheetProgress, {
      toValue: next ? 1 : 0,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }


  useEffect(() => {
    if (matchStage !== 'searching') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [matchStage, pulse]);

  // Listen for updates to the exact booking the passenger just created.
  // Polling is a fallback if Realtime publication is not enabled for bookings.
  useEffect(() => {
    if (!loggedIn || userRole !== 'passenger' || !activeBookingId) return;
    let cancelled = false;
    let checking = false;
    const checkBooking = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase.from('bookings')
          .select('id, status, driver_id, ride_type')
          .eq('id', activeBookingId).eq('passenger_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data || cancelled) return;
        setCurrentTripStatus(data.status);
        if (['accepted', 'arriving', 'in_progress'].includes(data.status) && data.driver_id) {
          const [profileResult, vehicleResult] = await Promise.all([
            supabase.from('profiles').select('full_name').eq('id', data.driver_id).maybeSingle(),
            supabase.from('vehicles').select('*').eq('driver_id', data.driver_id).limit(1),
          ]);
          if (cancelled) return;
          const vehicle = vehicleResult.data?.[0];
          setAssignedDriverId(data.driver_id);
          setAssignedDriver({
            name: profileResult.data?.full_name || 'Name unavailable',
            vehicle: vehicle?.vehicle_type || data.ride_type || 'Not available',
            plate: vehicle?.plate_number || 'Not available',
          });
          setMatchError('');
          setMatchStage((previous) => previous === 'searching' ? 'found' : previous);
        } else if (['cancelled', 'canceled', 'rejected', 'completed'].includes(data.status)) {
          setMatchStage('none');
          setAssignedDriverId(null);
          setDriverLivePoint(null);
          setDriverLocationUpdatedAt(null);
          setMatchError(`Booking status: ${data.status}`);
          setActiveBookingId(null);
          Alert.alert('Booking update', `Your booking status is now ${data.status}.`);
        }
      } catch (error: any) {
        if (!cancelled) setMatchError(error?.message || 'Could not check booking status.');
      } finally {
        checking = false;
      }
    };
    void checkBooking();
    const channel = supabase.channel(`rideon-booking-${activeBookingId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBookingId}` }, () => { void checkBooking(); })
      .subscribe();
    const timer = setInterval(() => { void checkBooking(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); void supabase.removeChannel(channel); };
  }, [loggedIn, userRole, activeBookingId]);

  // Track the assigned driver's latest location only while this passenger has an active booking.
  // Realtime events trigger a fresh RLS-protected SELECT; polling handles dropped events.
  useEffect(() => {
    if (!loggedIn || userRole !== 'passenger' || !activeBookingId || !assignedDriverId ||
        !['accepted', 'arriving', 'in_progress'].includes(currentTripStatus)) {
      setDriverLivePoint(null);
      setDriverLocationUpdatedAt(null);
      setDriverLocationError('');
      return;
    }
    let cancelled = false;
    let reading = false;
    const loadLocation = async () => {
      if (cancelled || reading) return;
      reading = true;
      try {
        const { data, error } = await supabase.from('driver_locations')
          .select('latitude, longitude, updated_at')
          .eq('driver_id', assignedDriverId).maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const latitude = Number(data?.latitude);
        const longitude = Number(data?.longitude);
        const timestamp = data?.updated_at ? Date.parse(data.updated_at) : NaN;
        if (data && Number.isFinite(latitude) && Number.isFinite(longitude) &&
            Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && Number.isFinite(timestamp)) {
          setDriverLivePoint({ latitude, longitude });
          setDriverLocationUpdatedAt(data.updated_at);
          setDriverLocationError('');
        } else {
          setDriverLivePoint(null);
          setDriverLocationUpdatedAt(null);
          setDriverLocationError('Waiting for the driver to share GPS...');
        }
      } catch (error: any) {
        if (!cancelled) setDriverLocationError(error?.message || 'Unable to load driver GPS.');
      } finally {
        reading = false;
      }
    };
    void loadLocation();
    const channel = supabase.channel(`rideon-driver-location-${assignedDriverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations',
        filter: `driver_id=eq.${assignedDriverId}` }, () => { void loadLocation(); })
      .subscribe();
    const refreshTimer = setInterval(() => { void loadLocation(); }, 10000);
    const clockTimer = setInterval(() => setLocationClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
      void supabase.removeChannel(channel);
    };
  }, [loggedIn, userRole, activeBookingId, assignedDriverId, currentTripStatus]);

  // Realtime driver dashboard: refresh pending requests and active trips whenever
  // a booking is created, accepted, or its trip status changes.
  useEffect(() => {
    if (!loggedIn || userRole !== 'driver' || !driverVehicle) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (cancelled) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!cancelled) void loadDriverDashboard();
      }, 350);
    };

    const channel = supabase
      .channel('rideon-driver-bookings')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'bookings',
      }, scheduleRefresh)
      .subscribe();

    // Backup refresh in case the mobile connection drops a Realtime event.
    const fallbackTimer = setInterval(scheduleRefresh, 20000);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [loggedIn, userRole, driverVehicle]);

  // Foreground-only GPS: stop when the app is backgrounded, the driver goes
  // offline, or there is no active booking. No background permission is requested.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => listener.remove();
  }, []);

  const driverHasActiveTrip = driverActiveTrips.length > 0;
  useEffect(() => {
    if (!loggedIn || userRole !== 'driver' || !driverRecord?.id ||
        driverRecord.verification_status !== 'approved' ||
        driverRecord.availability_status !== 'online' ||
        !driverHasActiveTrip || !appIsActive) {
      setDriverGpsStatus('Not sharing location');
      return;
    }

    let stopped = false;
    let subscription: Location.LocationSubscription | null = null;
    let saving = false;
    let lastSentAt = 0;
    const driverId: string = driverRecord.id;

    const startTracking = async () => {
      try {
        setDriverGpsStatus('Requesting GPS permission...');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (stopped) return;
        if (permission.status !== 'granted') {
          setDriverGpsStatus('Location permission denied');
          return;
        }
        const enabled = await Location.hasServicesEnabledAsync();
        if (stopped) return;
        if (!enabled) {
          setDriverGpsStatus('Turn on device location services');
          return;
        }
        setDriverGpsStatus('Waiting for GPS...');
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
          async (position) => {
            if (stopped || saving) return;
            const now = Date.now();
            if (now - lastSentAt < 5000) return;
            const { latitude, longitude } = position.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            saving = true;
            lastSentAt = now;
            try {
              const { error } = await supabase.from('driver_locations').upsert(
                { driver_id: driverId, latitude, longitude, updated_at: new Date().toISOString() },
                { onConflict: 'driver_id' }
              );
              if (error) throw error;
              if (!stopped) setDriverGpsStatus('Sharing live location');
            } catch (error: any) {
              if (!stopped) setDriverGpsStatus(`GPS upload failed: ${error?.message || 'Try again'}`);
            } finally {
              saving = false;
            }
          }
        );
        if (stopped) watcher.remove();
        else subscription = watcher;
      } catch (error: any) {
        if (!stopped) setDriverGpsStatus(`GPS unavailable: ${error?.message || 'Unknown error'}`);
      }
    };

    void startTracking();
    return () => {
      stopped = true;
      subscription?.remove();
    };
  }, [loggedIn, userRole, driverRecord?.id, driverRecord?.verification_status,
      driverRecord?.availability_status, driverHasActiveTrip, appIsActive]);

  // Keep the passenger's booking history current while that screen is open.
  useEffect(() => {
    if (!loggedIn || userRole !== 'passenger' || screen !== 'history') return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (cancelled) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!cancelled) void loadBookingHistory();
      }, 350);
    };
    const channel = supabase
      .channel('rideon-passenger-history')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'bookings',
      }, scheduleRefresh)
      .subscribe();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [loggedIn, userRole, screen]);

  async function initializeAccount(user: any) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('full_name, role').eq('id', user.id).single();
    if (profileError) throw new Error('Could not load account role: ' + profileError.message);
    const role: UserRole = profile.role === 'driver' ? 'driver' : 'passenger';
    setUserEmail(user.email ?? '');
    setUserName(profile.full_name || user.user_metadata?.full_name || 'User');
    setUserRole(role);
    setScreen('home');
    setLoggedIn(true);
    if (role === 'driver') void loadDriverDashboard(user.id);
  }

  // Refresh the dashboard when a driver logs in or taps Refresh.
  async function loadDriverDashboard(id?: string) {
    setDriverLoading(true);
    setDriverError('');
    try {
      const uid = id || (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error('Please log in again.');
      const { data: driver, error: driverErr } = await supabase
        .from('drivers').select('id, verification_status, availability_status')
        .eq('id', uid).maybeSingle();
      if (driverErr) throw driverErr;
      setDriverRecord(driver);
      if (!driver) {
        setDriverVehicle(null);
        setDriverBookings([]);
        setDriverActiveTrips([]);
        setDriverError('Your driver record has not been created yet. Contact the administrator.');
        return;
      }
      const { data: vehicles, error: vehicleErr } = await supabase
        .from('vehicles').select('vehicle_type').eq('driver_id', uid).limit(1);
      if (vehicleErr) throw vehicleErr;
      const vehicle = vehicles?.[0]?.vehicle_type ?? null;
      setDriverVehicle(vehicle);
      if (!vehicle) {
        setDriverBookings([]);
        setDriverActiveTrips([]);
        setDriverError('No vehicle is registered for your driver account.');
        return;
      }
      // RLS must restrict pending bookings to eligible, verified drivers.
      const { data: pending, error: pendingErr } = await supabase
        .from('bookings').select('id, ride_type, booking_type, pickup_address, dropoff_address, distance_km, estimated_fare, status, created_at')
        .eq('status', 'pending').eq('ride_type', vehicle)
        .order('created_at', { ascending: false }).limit(30);
      if (pendingErr) throw pendingErr;
      setDriverBookings(pending ?? []);
      // The driver sees their own accepted/ongoing bookings separately.
      const { data: activeTrips, error: activeErr } = await supabase
        .from('bookings')
        .select('id, ride_type, booking_type, pickup_address, dropoff_address, distance_km, estimated_fare, status, created_at')
        .eq('driver_id', uid)
        .in('status', ['accepted', 'arriving', 'in_progress'])
        .order('created_at', { ascending: false }).limit(30);
      if (activeErr) throw activeErr;
      setDriverActiveTrips(activeTrips ?? []);
    } catch (error: any) {
      setDriverError(error?.message || 'Unable to load driver dashboard.');
    } finally {
      setDriverLoading(false);
    }
  }

  async function toggleDriverAvailability() {
    if (!driverRecord || driverBusy) return;
    if (driverRecord.verification_status !== 'approved') {
      Alert.alert('Verification required', 'Your driver account must be approved before going online.');
      return;
    }
    setDriverBusy(true);
    const next = driverRecord.availability_status === 'online' ? 'offline' : 'online';
    const { error } = await supabase.from('drivers')
      .update({ availability_status: next }).eq('id', driverRecord.id);
    setDriverBusy(false);
    if (error) Alert.alert('Update failed', error.message);
    else setDriverRecord((prev: any) => ({ ...prev, availability_status: next }));
  }

  async function acceptDriverBooking(bookingId: string) {
    if (driverBusy || driverRecord?.verification_status !== 'approved' || driverRecord?.availability_status !== 'online') {
      Alert.alert('Not available', 'You must be approved and online to accept a booking.');
      return;
    }
    setDriverBusy(true);
    try {
      // Existing database function handles concurrent acceptance and permissions.
      // Confirm its argument name is p_booking_id in Supabase before testing.
      const { error } = await supabase.rpc('accept_booking', { p_booking_id: bookingId });
      if (error) throw error;
      Alert.alert('Booking accepted', 'The booking has been assigned to your account.');
      await loadDriverDashboard();
    } catch (error: any) {
      Alert.alert('Could not accept booking', error?.message || 'Please try again.');
    } finally {
      setDriverBusy(false);
    }
  }

  async function updateDriverTripStatus(bookingId: string, nextStatus: 'arriving' | 'in_progress' | 'completed') {
    if (driverBusy || driverRecord?.verification_status !== 'approved') return;
    setDriverBusy(true);
    try {
      // Requires the existing Supabase function update_trip_status(uuid, text).
      // Confirm argument names in Supabase before testing.
      const { error } = await supabase.rpc('update_trip_status', {
        p_booking_id: bookingId,
        p_new_status: nextStatus,
      });
      if (error) throw error;
      await loadDriverDashboard();
      Alert.alert('Trip updated', `Trip status is now ${nextStatus.replace('_', ' ')}.`);
    } catch (error: any) {
      Alert.alert('Update failed', error?.message || 'Unable to update the trip.');
    } finally {
      setDriverBusy(false);
    }
  }

  async function handleAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Information', 'Please enter your email and password.');
      return;
    }

    if (!isLogin && !fullName.trim()) {
      Alert.alert('Missing Information', 'Please enter your full name.');
      return;
    }

    if (!isLogin && password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        await initializeAccount(data.user);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim(), role: signupRole },
          },
        });

        if (error) throw error;

        if (data.session) {
          await initializeAccount(data.user);
        } else {
          Alert.alert(
            'Registration Successful',
            'Please check your email before logging in.'
          );
          setIsLogin(true);
        }
      }
    } catch (error: any) {
      Alert.alert('Authentication Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBookingHistory() {
    setHistoryLoading(true);
    setHistoryError('');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setBookings([]);
      setHistoryError('Please log in again to view your bookings.');
      setHistoryLoading(false);
      return;
    }
    // Only request bookings owned by the signed-in user.
    const { data, error } = await supabase.from('bookings').select('*').eq('passenger_id', user.id).order('created_at', { ascending: false }).limit(50);
    if (error) {
      setBookings([]);
      setHistoryError('Could not load booking history: ' + error.message);
    } else {
      setBookings(data ?? []);
    }
    setHistoryLoading(false);
  }

  function navigateTo(destination: 'home' | 'map' | 'history' | 'profile') {
    setMenuOpen(false);
    setMatchStage('none');
    setScreen(destination);
    if (destination === 'history') void loadBookingHistory();
  }

  function renderSidebar() {
    return (
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.drawerOverlay}>
          <View style={styles.drawerPanel}>
            <View style={styles.drawerTop}>
              <Text style={styles.drawerBrand}>RideON</Text>
              <TouchableOpacity onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu">
                <Text style={styles.drawerClose}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.drawerName}>{userName || 'Passenger'}</Text>
            <Text style={styles.drawerEmail}>{userEmail}</Text>
            <View style={styles.drawerDivider} />
            {([
              ['home', 'Home'],
              ['map', 'Maps'],
              ['history', 'Booking History'],
              ['profile', 'Profile'],
            ] as const).map(([destination, title]) => (
              <TouchableOpacity key={destination} style={[styles.drawerItem, screen === destination && styles.drawerSelected]} onPress={() => navigateTo(destination)}>
                <Text style={[styles.drawerItemText, screen === destination && styles.drawerSelectedText]}>{title}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.drawerItem} onPress={() => {
              setMenuOpen(false);
              Alert.alert('Log Out', 'Are you sure you want to log out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Log Out', style: 'destructive', onPress: () => void handleLogout() },
              ]);
            }}><Text style={styles.drawerLogout}>Log Out</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.drawerDismiss} activeOpacity={1} onPress={() => setMenuOpen(false)} accessibilityLabel="Dismiss menu" />
        </View>
      </Modal>
    );
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      Alert.alert('Logout Error', error.message);
      return;
    }

    setMenuOpen(false);
    setBookings([]);
    setBookingSaving(false);
    bookingSubmitting.current = false;
    setPickup('');
    setDropoff('');
    setPickupPoint(null);
    setDropoffPoint(null);
    setSelectingPoint(null);
    setPaymentMethod(null);
    setPreviewFare(null);
    setLoggedIn(false);
    setUserEmail('');
    setUserName('');
    setUserRole('passenger');
    setDriverRecord(null);
    setDriverBookings([]);
    setDriverActiveTrips([]);
    setDriverVehicle(null);
    setDriverError('');
    setPassword('');
    setSelectedRide(null);
    setBookingType(null);
    setScreen('home');
    setMatchStage('none');
    setActiveBookingId(null);
    setCurrentTripStatus('pending');
    setAssignedDriver(null);
    setAssignedDriverId(null);
    setDriverLivePoint(null);
    setDriverLocationUpdatedAt(null);
    setMatchError('');
    setSheetExpanded(true);
    sheetProgress.setValue(1);
  }

  async function handleConfirmBooking() {
    if (bookingSubmitting.current) return;
    if (!selectedRide || !bookingType) {
      Alert.alert('Booking Type', 'Choose a vehicle and booking type on Home first.');
      return;
    }
    if (!pickup.trim() || !dropoff.trim()) {
      Alert.alert('Missing Locations', 'Enter both pick-up and drop-off locations.');
      return;
    }
    if (!pickupPoint || !dropoffPoint || roadDistanceKm === null || previewFare === null || routeLoading || routeError) {
      Alert.alert('Route required', 'Set both pins and wait for a valid road distance and fare estimate before booking.');
      return;
    }

    if (!paymentMethod) {
      Alert.alert('Payment Method', 'Select a payment method first.');
      return;
    }

    bookingSubmitting.current = true;
    setBookingSaving(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Your session has expired. Please log in again.');

      // The Edge Function independently calculates the route and fare before saving.
      // Never send a client-calculated fare as the booking price.
      const { data: createdBooking, error } = await supabase.functions.invoke('create-booking', {
        body: {
          pickup: pickupPoint,
          dropoff: dropoffPoint,
          ride_type: selectedRide,
          booking_type: bookingType,
          payment_method: paymentMethod,
        },
      });
      if (error) {
        // Supabase FunctionsHttpError may contain a useful JSON error response.
        let detail = error.message;
        try {
          const response = (error as any).context;
          if (response && typeof response.json === 'function') {
            const payload = await response.json();
            detail = payload?.error || detail;
          }
        } catch { /* Keep the original error message. */ }
        throw new Error(detail);
      }
      if (createdBooking?.error) throw new Error(String(createdBooking.error));
      if (!createdBooking?.booking_id) throw new Error('Booking was not confirmed by the server.');

      setActiveBookingId(String(createdBooking.booking_id));
      setCurrentTripStatus('pending');
      setAssignedDriver(null);
      setAssignedDriverId(null);
      setDriverLivePoint(null);
      setDriverLocationUpdatedAt(null);
      setMatchError('');
      setMatchStage('searching');
    } catch (error: any) {
      Alert.alert('Booking Failed', error?.message || 'Could not save your booking. Please try again.');
    } finally {
      bookingSubmitting.current = false;
      setBookingSaving(false);
    }
  }

  function handleContinue() {
    if (!selectedRide) {
      Alert.alert('Select a Ride', 'Please choose Motorcycle or Tricycle.');
      return;
    }

    if (!bookingType) {
      Alert.alert('Select Booking Type', 'Please choose your booking type.');
      return;
    }

    setScreen('map');
    setPreviewFare(null);
    setSheetExpanded(true);
    sheetProgress.setValue(1);
  }

  // Circle-expansion splash: white start, navy circle, original logo, fade out.
  if (showSplash) {
    return (
      <Animated.View style={[styles.splashContainer, { backgroundColor: '#FFFFFF', opacity: splashOpacity, overflow: 'hidden' }]}>
        <StatusBar barStyle="dark-content" />
        <Animated.View style={{
          position: 'absolute',
          width: splashCircleDiameter,
          height: splashCircleDiameter,
          borderRadius: splashCircleDiameter / 2,
          backgroundColor: '#0A103C',
          transform: [{ scale: splashCircleScale }],
        }} />
        <Animated.Image
          source={require('./assets/images/rideon-logo.png')}
          style={[styles.splashLogo, {
            opacity: splashLogoOpacity,
            transform: [{ scale: splashLogoScale }],
          }]}
          resizeMode="contain"
        />
      </Animated.View>
    );
  }

  // DRIVER DASHBOARD — same RideON app, separate role-based interface.
  if (loggedIn && userRole === 'driver') {
    return (
      <View style={styles.driverPage}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.driverHeader}>
          <Text style={styles.driverHeading}>RideON Driver</Text>
          <TouchableOpacity onPress={() => void handleLogout()}><Text style={styles.driverLogout}>Log Out</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.driverContent}>
          <Text style={styles.driverWelcome}>Hello, {userName.split(' ')[0]}!</Text>
          <Text style={styles.driverSubheading}>Driver Dashboard</Text>
          <View style={styles.driverCard}>
            <Text style={styles.driverLabel}>Verification</Text>
            <Text style={styles.driverValue}>{driverRecord?.verification_status || 'No driver record'}</Text>
            <Text style={styles.driverLabel}>Registered vehicle</Text>
            <Text style={styles.driverValue}>{driverVehicle || 'Not registered'}</Text>
            <Text style={styles.driverLabel}>Availability</Text>
            <Text style={styles.driverValue}>{driverRecord?.availability_status || 'Offline'}</Text>
            <Text style={styles.driverLabel}>Live GPS</Text>
            <Text style={styles.driverGpsText}>{driverGpsStatus}</Text>
            <TouchableOpacity style={[styles.driverButton, driverRecord?.availability_status === 'online' && styles.driverOfflineButton]} disabled={driverBusy || !driverRecord} onPress={() => void toggleDriverAvailability()}>
              <Text style={styles.driverButtonText}>{driverBusy ? 'Please wait...' : driverRecord?.availability_status === 'online' ? 'Go Offline' : 'Go Online'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.driverSectionRow}>
            <Text style={styles.driverSectionTitle}>My Active Trips</Text>
            <TouchableOpacity onPress={() => void loadDriverDashboard()} disabled={driverLoading}>
              <Text style={styles.driverRefresh}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {!driverLoading && driverActiveTrips.length === 0 && (
            <Text style={styles.driverEmpty}>No active trips right now.</Text>
          )}
          {driverActiveTrips.map((trip) => {
            const nextStatus: 'arriving' | 'in_progress' | 'completed' =
              trip.status === 'accepted' ? 'arriving' :
              trip.status === 'arriving' ? 'in_progress' : 'completed';
            const actionLabel = nextStatus === 'arriving' ? 'Heading to Pickup' :
              nextStatus === 'in_progress' ? 'Start Trip' : 'Complete Trip';
            return (
              <View key={String(trip.id)} style={styles.driverCard}>
                <Text style={styles.driverBookingTitle}>{trip.booking_type === 'delivery' ? 'Item Delivery' : 'Passenger Ride'}</Text>
                <Text style={styles.driverDetail}>Pickup: {trip.pickup_address || 'Not specified'}</Text>
                <Text style={styles.driverDetail}>Drop-off: {trip.dropoff_address || 'Not specified'}</Text>
                <View style={styles.driverFareRow}>
                  <View style={styles.driverFareCell}>
                    <Text style={styles.driverFareLabel}>Road distance</Text>
                    <Text style={styles.driverFareValue}>{trip.distance_km == null ? 'Not available' : `${Number(trip.distance_km).toFixed(2)} km`}</Text>
                  </View>
                  <View style={styles.driverFareCell}>
                    <Text style={styles.driverFareLabel}>Estimated fare</Text>
                    <Text style={styles.driverFareValue}>{trip.estimated_fare == null ? 'Not available' : `₱${Number(trip.estimated_fare).toFixed(2)}`}</Text>
                  </View>
                </View>
                <Text style={styles.driverDetail}>Status: {String(trip.status).replace('_', ' ')}</Text>
                <TouchableOpacity style={styles.driverButton} disabled={driverBusy} onPress={() =>
                  Alert.alert('Update Trip', `Mark this trip as ${nextStatus.replace('_', ' ')}?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Confirm', onPress: () => void updateDriverTripStatus(String(trip.id), nextStatus) },
                  ])
                }>
                  <Text style={styles.driverButtonText}>{driverBusy ? 'Please wait...' : actionLabel}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={styles.driverSectionRow}>
            <Text style={styles.driverSectionTitle}>Available Bookings</Text>
            <TouchableOpacity onPress={() => void loadDriverDashboard()} disabled={driverLoading}><Text style={styles.driverRefresh}>Refresh</Text></TouchableOpacity>
          </View>
          {driverLoading ? <ActivityIndicator color="#304CFF" size="large" /> : null}
          {!!driverError && <Text style={styles.driverError}>{driverError}</Text>}
          {!driverLoading && !driverError && driverBookings.length === 0 && <Text style={styles.driverEmpty}>No pending bookings for your vehicle right now.</Text>}
          {driverBookings.map((booking) => (
            <View key={String(booking.id)} style={styles.driverCard}>
              <Text style={styles.driverBookingTitle}>{booking.booking_type === 'delivery' ? 'Item Delivery' : 'Passenger Ride'}</Text>
              <Text style={styles.driverDetail}>Vehicle: {booking.ride_type}</Text>
              <Text style={styles.driverDetail}>Pickup: {booking.pickup_address || 'Not specified'}</Text>
              <Text style={styles.driverDetail}>Drop-off: {booking.dropoff_address || 'Not specified'}</Text>
              <View style={styles.driverFareRow}>
                <View style={styles.driverFareCell}>
                  <Text style={styles.driverFareLabel}>Road distance</Text>
                  <Text style={styles.driverFareValue}>{booking.distance_km == null ? 'Not available' : `${Number(booking.distance_km).toFixed(2)} km`}</Text>
                </View>
                <View style={styles.driverFareCell}>
                  <Text style={styles.driverFareLabel}>Estimated fare</Text>
                  <Text style={styles.driverFareValue}>{booking.estimated_fare == null ? 'Not available' : `₱${Number(booking.estimated_fare).toFixed(2)}`}</Text>
                </View>
              </View>
              <Text style={styles.driverDetail}>Status: {booking.status}</Text>
              <TouchableOpacity style={styles.driverButton} disabled={driverBusy || driverRecord?.availability_status !== 'online' || driverRecord?.verification_status !== 'approved'} onPress={() => void acceptDriverBooking(String(booking.id))}>
                <Text style={styles.driverButtonText}>Accept Booking</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // Interactive map with selectable pickup/drop-off pins and road-distance preview
  if (loggedIn && screen === 'map') {
    return (
      <KeyboardAvoidingView
        style={styles.mapContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="dark-content" />
        <View style={styles.mapHeader}>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.mapBack}>
            <Text style={styles.mapMenuText}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.mapHeaderTitle}>Maps</Text>
          <View style={styles.mapBack} />
        </View>
        <View style={styles.mapSearchWrap}>
          <Text style={styles.mapSearchIcon}>⌕</Text>
          <TextInput
            placeholder="Search Location"
            placeholderTextColor="#AAAAAA"
            style={styles.mapSearchInput}
            onChangeText={(value) => { setDropoff(value); setDropoffPoint(null); setPreviewFare(null); }}
            value={dropoff}
          />
        </View>
        <View style={styles.mapBackground}>
          <MapView
            ref={mapRef}
            style={styles.mapArt}
            initialRegion={initialMapRegion}
            onPress={onMapPointPress}
            showsCompass
            showsUserLocation={!!userCoordinates}
            showsMyLocationButton={false}
          >
            {userCoordinates && (
              <Marker coordinate={userCoordinates} title="Your current location" pinColor="#304CFF" />
            )}
            {pickupPoint && (
              <Marker coordinate={pickupPoint} title="Pickup" description="Passenger pickup point" pinColor="green" />
            )}
            {dropoffPoint && (
              <Marker coordinate={dropoffPoint} title="Drop-off" description="Passenger drop-off point" pinColor="red" />
            )}
          </MapView>
          <TouchableOpacity
            style={styles.locateButton}
            disabled={gpsLoading}
            onPress={() => void centerOnMyLocation()}
            accessibilityLabel="Center map on my location"
          >
            {gpsLoading ? <ActivityIndicator color="#304CFF" /> : <Text style={styles.locateButtonText}>◎ My location</Text>}
          </TouchableOpacity>
          {selectingPoint && (
            <View style={styles.mapSelectionBanner}>
              <Text style={styles.mapSelectionText}>
                Tap the map to set {selectingPoint === 'pickup' ? 'PICKUP' : 'DROP-OFF'}
              </Text>
              <TouchableOpacity onPress={() => { setSelectingPoint(null); setSheetExpanded(true); Animated.timing(sheetProgress, { toValue: 1, duration: 250, useNativeDriver: false }).start(); }}>
                <Text style={styles.mapSelectionCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <Animated.View style={[styles.mapSheet, { height: sheetHeight }]}>
          <TouchableOpacity
            style={styles.sheetHandleTouch}
            onPress={toggleMapSheet}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={sheetExpanded ? 'Minimize booking panel' : 'Expand booking panel'}
          >
            <View style={styles.sheetHandle} />
          </TouchableOpacity>
          {sheetExpanded && (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.mapSheetContent}>
            <View style={styles.mapField}>
              <Text style={styles.mapFieldIcon}>◎</Text>
              <View style={styles.mapFieldText}>
                <Text style={styles.mapFieldTitle}>Pick-up Location</Text>
                <TextInput
                  value={pickup}
                  onChangeText={(value) => { setPickup(value); setPickupPoint(null); setPreviewFare(null); }}
                  placeholder="Coordinates or pickup description"
                  placeholderTextColor="#444444"
                  style={styles.mapFieldInput}
                />
              </View>
              <TouchableOpacity style={styles.pinSelectButton} onPress={() => startPointSelection('pickup')}>
                <Text style={styles.pinSelectText}>{pickupPoint ? 'Change Pickup Pin' : 'Set Pickup on Map'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.mapField}>
              <Text style={styles.mapFieldIcon}>⚑</Text>
              <View style={styles.mapFieldText}>
                <Text style={styles.mapFieldTitle}>Drop-off Location</Text>
                <TextInput
                  value={dropoff}
                  onChangeText={(value) => { setDropoff(value); setDropoffPoint(null); setPreviewFare(null); }}
                  placeholder="Coordinates or drop-off description"
                  placeholderTextColor="#444444"
                  style={styles.mapFieldInput}
                />
              </View>
              <TouchableOpacity style={styles.pinSelectButton} onPress={() => startPointSelection('dropoff')}>
                <Text style={styles.pinSelectText}>{dropoffPoint ? 'Change Drop-off Pin' : 'Set Drop-off on Map'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.mapPinNote}>Green = pickup · Red = drop-off. Choose both pins to calculate a road route. The final fare is verified when booking.</Text>
            <View style={styles.farePreviewBox}>
               <Text style={styles.farePreviewTitle}>Road distance & fare estimate</Text>
               {!pickupPoint || !dropoffPoint ? (
                 <Text style={styles.farePreviewNote}>Set both pickup and drop-off pins on the map to calculate the road distance and fare.</Text>
               ) : routeLoading ? (
                 <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
                   <ActivityIndicator color="#304CFF" />
                   <Text style={styles.farePreviewNote}>Calculating route and fare...</Text>
                 </View>
               ) : routeError ? (
                 <Text style={[styles.farePreviewNote, { color: '#C52A2A' }]}>Route unavailable: {routeError}. Move either pin to retry.</Text>
               ) : roadDistanceKm !== null && previewFare !== null ? (
                 <>
                   <Text style={styles.farePreviewResult}>Distance: {roadDistanceKm.toFixed(2)} km</Text>
                   {roadDurationMinutes !== null && <Text style={styles.farePreviewNote}>Estimated driving time: {roadDurationMinutes} min</Text>}
                   <Text style={styles.farePreviewResult}>Estimated fare: ₱{previewFare.toFixed(2)}</Text>
                   <Text style={styles.farePreviewNote}>Preview only. The server verifies the final distance and fare when you confirm.</Text>
                 </>
               ) : (
                 <Text style={styles.farePreviewNote}>Waiting for route calculation...</Text>
               )}
             </View>
            <TouchableOpacity
              style={styles.mapPaymentButton}
              onPress={() => Alert.alert('Payment Method', 'Choose a payment method', [
                { text: 'Cash on Delivery (COD)', onPress: () => setPaymentMethod('COD') },
                { text: 'Cancel', style: 'cancel' },
              ])}
            >
              <Text style={styles.mapGrayButtonText}>
                {paymentMethod ? `Payment: ${paymentMethod}` : 'Select Payment Method'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mapConfirmButton}
              onPress={() => void handleConfirmBooking()}
              disabled={bookingSaving}
              accessibilityState={{ disabled: bookingSaving }}
            >
              {bookingSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.mapConfirmText}>Confirm Book</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
          )}
        </Animated.View>

        {renderSidebar()}

        {/* Figma-style rider matching overlay: prototype only */}
        <Modal
          visible={matchStage !== 'none'}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setMatchStage('none')}
        >
          <View style={styles.matchOverlay}>
            <View style={styles.matchDialog}>
              {matchStage === 'searching' ? (
                <>
                  <Text style={styles.searchSymbol}>⌕</Text>
                  <Text style={styles.matchHeading}>Searching for Riders...</Text>
                  <View style={styles.dotArea}>
                    <Animated.View style={[styles.purpleDot, {
                      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.65] }) }],
                    }]} />
                    <Animated.View style={[styles.blueDot, {
                      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1.2] }) }],
                    }]} />
                  </View>
                  <TouchableOpacity style={styles.stopSearching} onPress={() => setMatchStage('none')}>
                    <Text style={styles.stopSearchingText}>Hide search</Text>
                  </TouchableOpacity>
                  <Text style={styles.demoNotice}>Waiting for a real driver to accept your booking.</Text>
                </>
              ) : (
                <>
                  <View style={styles.foundCheck}><Text style={styles.foundCheckText}>✓</Text></View>
                  <Text style={styles.foundTitle}>Rider Found!</Text>
                  <View style={styles.riderInfo}>
                    <Text style={styles.riderInfoTitle}>Rider information:</Text>
                    <Text style={styles.riderInfoText}>Name: {assignedDriver?.name || 'Name unavailable'}</Text>
                    <Text style={styles.riderInfoText}>Vehicle: {assignedDriver?.vehicle || 'Not available'}</Text>
                    <Text style={styles.riderInfoText}>Plate: {assignedDriver?.plate || 'Not available'}</Text>
                    <Text style={styles.demoNotice}>This booking was accepted in Supabase.</Text>
                  </View>
                  <TouchableOpacity style={styles.closePreview} onPress={() => { setMatchStage('none'); setScreen('tracking'); }}>
                    <Text style={styles.closePreviewText}>View pickup details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.demoLink} onPress={() => setMatchStage('none')}>
                    <Text style={styles.demoLinkText}>Close preview</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // PICKUP TRACKING — assigned driver position from Supabase; no ETA or messaging yet
  if (loggedIn && screen === 'tracking') {
    return (
      <View style={styles.trackingContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.mapHeader}>
          <TouchableOpacity style={styles.mapBack} onPress={() => setScreen('map')}>
            <Text style={styles.trackingBackText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.mapHeaderTitle}>Pickup Tracking</Text>
          <View style={styles.mapBack} />
        </View>
        <View style={styles.trackingMap}>
          <MapView
            ref={trackingMapRef}
            style={styles.mapArt}
            initialRegion={pickupPoint ? { ...pickupPoint, latitudeDelta: 0.02, longitudeDelta: 0.02 } : initialMapRegion}
            showsCompass
          >
            {pickupPoint && <Marker coordinate={pickupPoint} title="Pickup" pinColor="green" />}
            {dropoffPoint && <Marker coordinate={dropoffPoint} title="Drop-off" pinColor="red" />}
            {driverLocationFresh && driverLivePoint && (
              <Marker coordinate={driverLivePoint} title="Your driver (live GPS)" pinColor="#304CFF" />
            )}
          </MapView>
          {driverLocationFresh && driverLivePoint && (
            <TouchableOpacity style={styles.trackingCenterButton} onPress={() =>
              trackingMapRef.current?.animateToRegion({ ...driverLivePoint, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 600)
            }>
              <Text style={styles.locateButtonText}>◎ Find driver</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.trackingPanel}>
          <View style={styles.trackingPill} />
          <Text style={styles.trackingStatus}>{currentTripStatus === 'arriving' ? 'Driver is heading to pickup' : currentTripStatus === 'in_progress' ? 'Your trip is in progress' : currentTripStatus === 'completed' ? 'Trip completed' : 'Your booking has been accepted'}</Text>
          <Text style={styles.trackingNote}>Status: {currentTripStatus.replace('_', ' ')}.</Text>
          <Text style={styles.trackingGpsStatus}>
            {driverLocationFresh
              ? `Live GPS · updated ${Math.max(0, Math.floor(driverLocationAgeMs / 1000))} seconds ago`
              : driverLocationUpdatedAt
                ? `GPS unavailable · last update ${new Date(driverLocationUpdatedAt).toLocaleTimeString()}`
                : driverLocationError || 'Waiting for driver GPS...'}
          </Text>
          <View style={styles.trackingDivider} />
          <Text style={styles.trackingLabel}>Rider information</Text>
          <Text style={styles.trackingValue}>{assignedDriver?.name || 'Name unavailable'}</Text>
          <Text style={styles.trackingDetail}>Vehicle: {assignedDriver?.vehicle || 'Not available'}</Text>
          <Text style={styles.trackingDetail}>Plate number: {assignedDriver?.plate || 'Not available'}</Text>
          <Text style={styles.trackingDetail}>Estimated arrival: Not available</Text>
          <View style={styles.trackingActions}>
            <TouchableOpacity style={styles.trackingAction} onPress={() => Alert.alert('Call rider', 'Calling is not connected yet.')}>
              <Text style={styles.trackingActionText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.trackingAction} onPress={() => Alert.alert('Message rider', 'Messaging is not connected yet.')}>
              <Text style={styles.trackingActionText}>Message</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.trackingReturn} onPress={() => setScreen('map')}>
            <Text style={styles.trackingReturnText}>Back to Maps</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // BOOKING HISTORY — reads existing Supabase bookings; no fake rides added.
  if (loggedIn && screen === 'history') {
    return (
      <View style={styles.pageContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.mapHeader}>
          <TouchableOpacity style={styles.mapBack} onPress={() => setMenuOpen(true)}><Text style={styles.mapMenuText}>☰</Text></TouchableOpacity>
          <Text style={styles.mapHeaderTitle}>Booking History</Text>
          <TouchableOpacity style={styles.mapBack} onPress={() => void loadBookingHistory()}><Text style={styles.historyRefresh}>↻</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.historyContent}>
          {historyLoading ? <ActivityIndicator color="#304CFF" size="large" /> : historyError ? (
            <Text style={styles.historyMessage}>{historyError}</Text>
          ) : bookings.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyTitle}>No bookings yet</Text>
              <Text style={styles.historyMessage}>Your saved bookings will appear here after you confirm a booking.</Text>
              <TouchableOpacity style={styles.historyGoButton} onPress={() => navigateTo('home')}><Text style={styles.historyGoText}>Book a ride</Text></TouchableOpacity>
            </View>
          ) : bookings.map((booking, index) => (
            <View key={String(booking.id ?? index)} style={styles.historyCard}>
              <Text style={styles.historyCardTitle}>Booking {index + 1}</Text>
              <Text style={styles.historyDetail}>Status: {String(booking.status ?? 'Not available')}</Text>
              <Text style={styles.historyDetail}>Vehicle: {booking.ride_type === 'motorcycle' ? 'Motorcycle' : booking.ride_type === 'tricycle' ? 'Tricycle' : 'Not recorded'}</Text>
              <Text style={styles.historyDetail}>Booking type: {booking.booking_type === 'delivery' ? 'Deliver an item' : booking.booking_type === 'ride' ? 'Book a ride' : 'Not recorded'}</Text>
              <Text style={styles.historyDetail}>Payment: {String(booking.payment_method ?? 'Not selected')} ({String(booking.payment_status ?? 'Not available')})</Text>
              <Text style={styles.historyDetail}>Fare: {booking.estimated_fare == null && booking.fare == null ? 'Not saved yet' : `₱${Number(booking.estimated_fare ?? booking.fare).toFixed(2)}`}</Text>
              <Text style={styles.historyDetail}>Pickup: {String(booking.pickup_location ?? booking.pickup_address ?? 'Not available')}</Text>
              <Text style={styles.historyDetail}>Drop-off: {String(booking.dropoff_location ?? booking.dropoff_address ?? 'Not available')}</Text>
              <Text style={styles.historyDetail}>Date: {booking.created_at ? new Date(booking.created_at).toLocaleDateString() : 'Not available'}</Text>
            </View>
          ))}
        </ScrollView>
        {renderSidebar()}
      </View>
    );
  }

  // PROFILE — displays signed-in passenger details.
  if (loggedIn && screen === 'profile') {
    return (
      <View style={styles.pageContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.mapHeader}>
          <TouchableOpacity style={styles.mapBack} onPress={() => setMenuOpen(true)}><Text style={styles.mapMenuText}>☰</Text></TouchableOpacity>
          <Text style={styles.mapHeaderTitle}>Profile</Text>
          <View style={styles.mapBack} />
        </View>
        <View style={styles.profileBody}>
          <View style={styles.profileAvatar}><Text style={styles.profileInitial}>{(userName || 'P').charAt(0).toUpperCase()}</Text></View>
          <Text style={styles.profileName}>{userName || 'Passenger'}</Text>
          <Text style={styles.profileEmail}>{userEmail}</Text>
          <Text style={styles.profileHint}>Profile editing will be added in a later update.</Text>
        </View>
        {renderSidebar()}
      </View>
    );
  }

  // HOME SCREEN
  if (loggedIn) {
    return (
      <View style={styles.homeContainer}>
        <StatusBar barStyle="dark-content" />

        <ScrollView
          contentContainerStyle={styles.homeContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.homeHeader}>
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setMenuOpen(true)}
            >
              <Text style={styles.menuIcon}>☰</Text>
            </TouchableOpacity>

            <Text style={styles.homeHeaderTitle}>Home</Text>

            <View style={{ width: 35 }} />
          </View>

          <Text style={styles.greeting}>
            Hello, {userName.split(' ')[0]}!
          </Text>

          <Text style={styles.homeTitle}>Choose your ride</Text>

          <Text style={styles.homeSubtitle}>
            How would you like to travel today?
          </Text>

          {/* MOTORCYCLE */}
          <TouchableOpacity
            style={[
              styles.rideCard,
              selectedRide === 'motorcycle' && styles.selectedCard,
            ]}
            onPress={() => setSelectedRide('motorcycle')}
            activeOpacity={0.8}
          >
            <View style={styles.rideCardHeader}>
              <Text style={styles.rideTitle}>Motorcycle</Text>

              <View
                style={[
                  styles.radioCircle,
                  selectedRide === 'motorcycle' && styles.radioSelected,
                ]}
              >
                {selectedRide === 'motorcycle' && (
                  <View style={styles.radioInner} />
                )}
              </View>
            </View>

            <View style={styles.rideCardBody}>
              <Image
                source={require('./assets/images/motorcycle.png')}
                style={styles.vehicleImage}
                resizeMode="contain"
              />

              <Text style={styles.rideDescription}>
                A two-wheel motorcycle ride.
              </Text>
            </View>
          </TouchableOpacity>

          {/* TRICYCLE */}
          <TouchableOpacity
            style={[
              styles.rideCard,
              selectedRide === 'tricycle' && styles.selectedCard,
            ]}
            onPress={() => setSelectedRide('tricycle')}
            activeOpacity={0.8}
          >
            <View style={styles.rideCardHeader}>
              <Text style={styles.rideTitle}>Tricycle</Text>

              <View
                style={[
                  styles.radioCircle,
                  selectedRide === 'tricycle' && styles.radioSelected,
                ]}
              >
                {selectedRide === 'tricycle' && (
                  <View style={styles.radioInner} />
                )}
              </View>
            </View>

            <View style={styles.rideCardBody}>
              <Image
                source={require('./assets/images/tricycle.png')}
                style={styles.vehicleImage}
                resizeMode="contain"
              />

              <Text style={styles.rideDescription}>
                A motorcycle with a covered sidecar.
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.bookingHeading}>
            What kind of booking?
          </Text>

          <View style={styles.bookingRow}>
            <TouchableOpacity
              style={[
                styles.bookingCard,
                bookingType === 'delivery' && styles.selectedCard,
              ]}
              onPress={() => setBookingType('delivery')}
            >
              <Text style={styles.bookingIcon}>⬡</Text>
              <Text style={styles.bookingCardText}>
                Deliver an{'\n'}item
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.bookingCard,
                bookingType === 'ride' && styles.selectedCard,
              ]}
              onPress={() => setBookingType('ride')}
            >
              <Text style={styles.bookingIcon}>⌂</Text>
              <Text style={styles.bookingCardText}>
                Book a ride
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
          >
            <Text style={styles.continueButtonText}>
              Continue to map
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {renderSidebar()}
      </View>
    );
  }

  // LOGIN / REGISTER
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.content}>
        <Image
          source={require('./assets/images/rideon-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />

        <Text style={styles.heading}>
          {isLogin ? 'Welcome Back!' : 'Create Account'}
        </Text>

        <Text style={styles.subtitle}>
          {isLogin
            ? 'Log in to continue your journey.'
            : 'Join RideON and get moving.'}
        </Text>

        {!isLogin && (
          <View style={styles.accountTypeSection}>
            <Text style={styles.accountTypeTitle}>I want to sign up as a:</Text>
            <View style={styles.accountTypeRow}>
              {(['passenger', 'driver'] as const).map((role) => (
                <TouchableOpacity
                  key={role}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: signupRole === role }}
                  onPress={() => setSignupRole(role)}
                  style={[styles.accountTypeCard, signupRole === role && styles.accountTypeSelected]}
                >
                  <Text style={styles.accountTypeIcon}>{role === 'passenger' ? '👤' : '🏍️'}</Text>
                  <Text style={styles.accountTypeLabel}>
                    {role === 'passenger' ? 'Passenger' : 'Driver'}
                  </Text>
                  <Text style={styles.accountTypeDescription}>
                    {role === 'passenger' ? 'Book rides & deliveries' : 'Accept bookings after approval'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {signupRole === 'driver' && (
              <Text style={styles.accountTypeNote}>
                Driver accounts start as pending verification. You must register a vehicle and be approved before accepting bookings.
              </Text>
            )}
          </View>
        )}

        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            placeholderTextColor="#888"
            value={fullName}
            onChangeText={setFullName}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email Address"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              {isLogin ? 'LOG IN' : 'REGISTER'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsLogin(!isLogin)}
          style={styles.switchButton}
        >
          <Text style={styles.switchText}>
            {isLogin
              ? "Don't have an account? Register"
              : 'Already have an account? Log in'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  splashContainer: { flex: 1, backgroundColor: '#0A103C', justifyContent: 'center', alignItems: 'center', padding: 24 },
  splashLogo: { width: 220, height: 170 },
  splashTitle: { color: '#FFFFFF', fontSize: 34, fontWeight: 'bold', marginTop: 8 },
  splashTagline: { color: '#C5C8D9', fontSize: 15, marginTop: 8 },
  splashSpinner: { marginTop: 36 },
  driverPage: { flex: 1, backgroundColor: '#FFFFFF' },
  driverHeader: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  driverHeading: { fontSize: 23, fontWeight: 'bold', color: '#304CFF' },
  driverLogout: { color: '#D83B3B', fontSize: 15, fontWeight: '600' },
  driverContent: { paddingHorizontal: 22, paddingTop: 25, paddingBottom: 45 },
  driverWelcome: { fontSize: 17, color: '#555555' },
  driverSubheading: { fontSize: 28, fontWeight: 'bold', color: '#333333', marginTop: 10, marginBottom: 22 },
  driverCard: { backgroundColor: '#F3F3F3', borderRadius: 20, padding: 20, marginBottom: 16 },
  driverLabel: { fontSize: 14, color: '#777777', marginTop: 9 },
  driverValue: { fontSize: 18, fontWeight: '600', color: '#333333', marginTop: 3, textTransform: 'capitalize' },
  driverButton: { backgroundColor: '#304CFF', borderRadius: 24, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  driverOfflineButton: { backgroundColor: '#666666' },
  driverButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  driverSectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, marginBottom: 15 },
  driverSectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#333333' },
  driverRefresh: { color: '#304CFF', fontSize: 16, fontWeight: '600' },
  driverError: { color: '#C52A2A', fontSize: 13, marginVertical: 10, textAlign: 'center' },
  driverGpsText: { color: '#304CFF', fontSize: 14, marginTop: 4 },
  driverEmpty: { color: '#777777', fontSize: 15, marginVertical: 15 },
  driverBookingTitle: { fontSize: 18, fontWeight: 'bold', color: '#333333', marginBottom: 10 },
  driverDetail: { color: '#555555', fontSize: 15, marginTop: 5 },
  driverFareRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  driverFareCell: { flex: 1, backgroundColor: '#E9EDFF', borderRadius: 14, padding: 12 },
  driverFareLabel: { color: '#59637A', fontSize: 12, marginBottom: 5 },
  driverFareValue: { color: '#304CFF', fontSize: 17, fontWeight: 'bold' },

  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.38)' },
  drawerPanel: { width: '78%', maxWidth: 320, backgroundColor: '#FFFFFF', paddingTop: Platform.OS === 'android' ? 48 : 65, paddingHorizontal: 22, paddingBottom: 32 },
  drawerDismiss: { flex: 1 },
  drawerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  drawerBrand: { fontSize: 30, fontWeight: 'bold', color: '#304CFF' },
  drawerClose: { fontSize: 32, color: '#444444', paddingHorizontal: 8 },
  drawerName: { fontSize: 19, fontWeight: 'bold', color: '#333333', marginTop: 30 },
  drawerEmail: { fontSize: 13, color: '#777777', marginTop: 4 },
  drawerDivider: { height: 1, backgroundColor: '#E5E5E5', marginVertical: 22 },
  drawerItem: { paddingVertical: 16, paddingHorizontal: 15, borderRadius: 15, marginBottom: 7 },
  drawerSelected: { backgroundColor: '#EEF0FF' },
  drawerItemText: { fontSize: 17, fontWeight: '600', color: '#3D3D3D' },
  drawerSelectedText: { color: '#304CFF' },
  drawerLogout: { fontSize: 17, fontWeight: 'bold', color: '#D83B3B' },
  pageContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  historyRefresh: { fontSize: 27, color: '#304CFF' },
  historyContent: { padding: 24, paddingBottom: 50 },
  historyEmpty: { alignItems: 'center', marginTop: 110 },
  historyEmptyTitle: { fontSize: 22, fontWeight: 'bold', color: '#333333' },
  historyMessage: { fontSize: 15, color: '#777777', textAlign: 'center', marginTop: 12, lineHeight: 22 },
  historyGoButton: { backgroundColor: '#304CFF', paddingHorizontal: 30, paddingVertical: 13, borderRadius: 25, marginTop: 26 },
  historyGoText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  historyCard: { backgroundColor: '#F3F3F3', padding: 20, borderRadius: 20, marginBottom: 16 },
  historyCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333333', marginBottom: 9 },
  historyDetail: { fontSize: 14, color: '#555555', marginTop: 5 },
  profileBody: { alignItems: 'center', padding: 26, paddingTop: 70 },
  profileAvatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#304CFF', justifyContent: 'center', alignItems: 'center' },
  profileInitial: { fontSize: 42, fontWeight: 'bold', color: '#FFFFFF' },
  profileName: { fontSize: 24, fontWeight: 'bold', color: '#333333', marginTop: 18 },
  profileEmail: { fontSize: 15, color: '#777777', marginTop: 6 },
  profileHint: { fontSize: 13, color: '#888888', marginTop: 30, textAlign: 'center' },
  matchOverlay: { flex: 1, backgroundColor: 'rgba(245,245,245,0.78)', justifyContent: 'center', paddingHorizontal: 20 },
  matchDialog: { backgroundColor: '#FFFFFF', borderRadius: 19, minHeight: 320, paddingHorizontal: 25, paddingVertical: 34, alignItems: 'center', justifyContent: 'center' },
  searchSymbol: { fontSize: 52, color: '#333943', height: 68 },
  matchHeading: { fontSize: 19, fontWeight: 'bold', color: '#606060', textAlign: 'center' },
  dotArea: { width: 92, height: 68, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  purpleDot: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#6E118A' },
  blueDot: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#1539E8', marginLeft: -6 },
  stopSearching: { backgroundColor: '#FF0808', borderRadius: 11, paddingVertical: 12, paddingHorizontal: 25, minWidth: 200, alignItems: 'center' },
  stopSearchingText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 19 },
  demoLink: { marginTop: 15, padding: 5 },
  demoLinkText: { fontSize: 12, color: '#555555', textDecorationLine: 'underline' },
  foundCheck: { width: 67, height: 67, borderRadius: 34, backgroundColor: '#80E878', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  foundCheckText: { color: '#FFFFFF', fontSize: 45, fontWeight: '300' },
  foundTitle: { color: '#606060', fontSize: 28, fontWeight: 'bold', marginBottom: 14 },
  riderInfo: { width: '100%' },
  riderInfoTitle: { fontSize: 19, color: '#444444', fontWeight: 'bold' },
  riderInfoText: { fontSize: 19, color: '#444444', lineHeight: 24 },
  demoNotice: { color: '#777777', fontSize: 12, marginTop: 12 },
  closePreview: { marginTop: 15, backgroundColor: '#304CFF', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 22 },
  closePreviewText: { color: '#FFFFFF', fontWeight: 'bold' },
  trackingContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  trackingBackText: { fontSize: 32, color: '#333333', lineHeight: 38 },
  trackingMap: { flex: 1, width: '100%' },
  trackingCenterButton: { position: 'absolute', top: 14, right: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, elevation: 4 },
  trackingGpsStatus: { color: '#304CFF', fontSize: 12, textAlign: 'center', marginTop: 7 },
  trackingPanel: { backgroundColor: '#FFFFFF', paddingHorizontal: 25, paddingTop: 14, paddingBottom: Platform.OS === 'android' ? 42 : 28, borderTopLeftRadius: 36, borderTopRightRadius: 36, marginTop: -32 },
  trackingPill: { width: 110, height: 5, borderRadius: 4, backgroundColor: '#999999', alignSelf: 'center', marginBottom: 16 },
  trackingStatus: { fontSize: 20, fontWeight: 'bold', color: '#333333', textAlign: 'center' },
  trackingNote: { fontSize: 12, color: '#777777', textAlign: 'center', marginTop: 6 },
  trackingDivider: { height: 1, backgroundColor: '#E5E5E5', marginVertical: 16 },
  trackingLabel: { fontSize: 16, fontWeight: 'bold', color: '#444444' },
  trackingValue: { fontSize: 18, fontWeight: 'bold', color: '#333333', marginTop: 5 },
  trackingDetail: { fontSize: 14, color: '#555555', marginTop: 5 },
  trackingActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  trackingAction: { flex: 1, backgroundColor: '#304CFF', borderRadius: 24, alignItems: 'center', paddingVertical: 12 },
  trackingActionText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  trackingReturn: { alignItems: 'center', paddingTop: 15 },
  trackingReturnText: { color: '#304CFF', fontSize: 14, fontWeight: '600' },
  mapContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  mapHeader: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  mapBack: { width: 35 },
  mapMenuText: { fontSize: 24, color: '#333333' },
  mapHeaderTitle: { fontSize: 22, fontWeight: 'bold', color: '#050505' },
  mapSearchWrap: { height: 52, borderWidth: 1, borderColor: '#A8A8A8', borderRadius: 28, marginHorizontal: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22 },
  mapSearchIcon: { fontSize: 31, color: '#D0D0D0', marginRight: 12 },
  mapSearchInput: { flex: 1, fontSize: 18, color: '#333333', paddingVertical: 0 },
  mapBackground: { flex: 1, overflow: 'hidden', backgroundColor: '#D7D7D7' },
  mapArt: { width: '100%', height: '100%' },
  mapSelectionBanner: { position: 'absolute', top: 66, left: 12, right: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, elevation: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mapSelectionText: { fontSize: 14, fontWeight: 'bold', color: '#24356A', flex: 1 },
  mapSelectionCancel: { color: '#D83B3B', fontWeight: 'bold', marginLeft: 12 },
  pinSelectButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, marginTop: 6, backgroundColor: '#304CFF', borderRadius: 14 },
  pinSelectText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  mapPinNote: { fontSize: 12, color: '#666666', marginBottom: 12, lineHeight: 18 },
  locateButton: { position: 'absolute', top: 14, right: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, elevation: 4 },
  locateButtonText: { color: '#304CFF', fontSize: 14, fontWeight: 'bold' },
  mapSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 50, borderTopRightRadius: 50, paddingHorizontal: 25, paddingTop: 12, overflow: 'hidden', elevation: 8 },
  sheetHandleTouch: { height: 48, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 9 },
  sheetHandle: { height: 5, width: 148, borderRadius: 4, backgroundColor: '#999999' },
  mapSheetContent: { paddingBottom: Platform.OS === 'android' ? 52 : 34 },
  mapField: { backgroundColor: '#E7E5E5', borderRadius: 23, minHeight: 79, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 12 },
  mapFieldIcon: { color: '#1A2467', fontSize: 32, width: 39 },
  mapFieldText: { flex: 1 },
  mapFieldTitle: { color: '#393939', fontSize: 19, fontWeight: '600' },
  mapFieldInput: { fontSize: 17, color: '#333333', paddingVertical: 1 },
  farePreviewBox: { backgroundColor: '#F5F6FF', borderRadius: 18, padding: 14, marginBottom: 10 },
  farePreviewTitle: { fontSize: 16, fontWeight: 'bold', color: '#28346B' },
  farePreviewNote: { fontSize: 12, color: '#555555', marginTop: 5, lineHeight: 18 },
  fareDistanceInput: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, color: '#333333', marginTop: 10 },
  farePreviewResult: { fontSize: 18, fontWeight: 'bold', color: '#304CFF', marginTop: 10 },
  mapGrayButton: { backgroundColor: '#E7E5E5', minHeight: 80, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mapPaymentButton: { backgroundColor: '#E7E5E5', minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mapGrayButtonText: { color: '#414141', fontSize: 18, fontWeight: '600' },
  mapConfirmButton: { backgroundColor: '#304CFF', minHeight: 50, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  mapConfirmText: { color: '#FFFFFF', fontSize: 19, fontWeight: 'bold' },
  // AUTH STYLES
  accountTypeSection: { marginBottom: 16 },
  accountTypeTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginBottom: 10 },
  accountTypeRow: { flexDirection: 'row', gap: 12 },
  accountTypeCard: { flex: 1, borderWidth: 2, borderColor: '#687097', borderRadius: 12, padding: 12, alignItems: 'center', backgroundColor: '#17204D' },
  accountTypeSelected: { borderColor: '#85A3FF', backgroundColor: '#253A7A' },
  accountTypeIcon: { fontSize: 24, marginBottom: 6 },
  accountTypeLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  accountTypeDescription: { color: '#D9E0FF', fontSize: 11, textAlign: 'center', marginTop: 5 },
  accountTypeNote: { color: '#E3E8FF', fontSize: 12, lineHeight: 18, marginTop: 10 },
  container: {
    flex: 1,
    backgroundColor: '#0A103C',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 25,
  },
  logoImage: {
    width: 180,
    height: 130,
    alignSelf: 'center',
    marginBottom: 25,
  },
  heading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#C5C8D9',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 30,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    fontSize: 15,
    marginBottom: 15,
    color: '#000000',
  },
  button: {
    backgroundColor: '#4169E1',
    padding: 17,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  switchButton: {
    marginTop: 25,
    alignItems: 'center',
  },
  switchText: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  // HOME STYLES
  homeContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  homeContent: {
    paddingHorizontal: 25,
    paddingBottom: 40,
  },
  homeHeader: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuButton: {
    width: 35,
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 25,
    color: '#30343B',
  },
  homeHeaderTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333333',
  },
  greeting: {
    fontSize: 16,
    color: '#555555',
    marginTop: 10,
  },
  homeTitle: {
    fontSize: 29,
    fontWeight: 'bold',
    color: '#3F3F3F',
    marginTop: 10,
  },
  homeSubtitle: {
    fontSize: 14,
    color: '#555555',
    marginTop: 8,
    marginBottom: 28,
  },
  rideCard: {
    backgroundColor: '#F3F3F3',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    padding: 17,
    marginBottom: 22,
    minHeight: 170,
  },
  selectedCard: {
    borderColor: '#304CFF',
    borderWidth: 2,
  },
  rideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rideTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#3D3D3D',
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#AEB1B5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#304CFF',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#304CFF',
  },
  rideCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
  },
  vehicleImage: {
    width: 140,
    height: 100,
  },
  rideDescription: {
    flex: 1,
    fontSize: 14,
    lineHeight: 23,
    color: '#777777',
    marginLeft: 8,
  },
  bookingHeading: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#3D3D3D',
    marginTop: 2,
    marginBottom: 10,
  },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 18,
  },
  bookingCard: {
    flex: 1,
    backgroundColor: '#F3F3F3',
    borderRadius: 24,
    minHeight: 75,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bookingIcon: {
    fontSize: 30,
    color: '#222222',
  },
  bookingCardText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#3D3D3D',
    lineHeight: 22,
  },
  continueButton: {
    backgroundColor: '#304CFF',
    borderRadius: 30,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 22,
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: 'bold',
  },
});
