import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import axios from 'axios';

// The Localhost Trap: use internal IP or ngrok!
const rawApiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';
const API_URL = /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `http://${rawApiUrl}`;
const LOG_PREFIX = '[HackathonApp]';

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

function log(event: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`${LOG_PREFIX} ${event}`, payload);
    return;
  }
  console.log(`${LOG_PREFIX} ${event}`);
}

api.interceptors.request.use((config) => {
  log('API_REQUEST', {
    method: config.method?.toUpperCase() || 'GET',
    url: `${config.baseURL || ''}${config.url || ''}`,
    data: config.data ?? null,
    params: config.params ?? null,
  });
  return config;
});

api.interceptors.response.use(
  (response) => {
    log('API_RESPONSE', {
      method: response.config.method?.toUpperCase() || 'GET',
      url: `${response.config.baseURL || ''}${response.config.url || ''}`,
      status: response.status,
      data: response.data ?? null,
    });
    return response;
  },
  (error) => {
    log('API_ERROR', {
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      data: error?.response?.data ?? null,
      url: `${error?.config?.baseURL || ''}${error?.config?.url || ''}`,
    });
    return Promise.reject(error);
  }
);

type ActionType = 'register' | 'redbull' | 'dinner';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [mobileNum, setMobileNum] = useState('');
  const [activeTab, setActiveTab] = useState<ActionType>('register');
  const [checkInCount, setCheckInCount] = useState(0);
  const scanLockRef = useRef(false);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayType, setOverlayType] = useState<'success' | 'error'>('success');
  const [overlayMessage, setOverlayMessage] = useState('');
  const [overlaySubMessage, setOverlaySubMessage] = useState('');

  useEffect(() => {
    log('APP_MOUNT', { rawApiUrl, resolvedApiUrl: API_URL });
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    log('STATS_POLLING_STARTED', { intervalMs: 5000 });
    return () => {
      clearInterval(interval);
      log('APP_UNMOUNT');
    };
  }, []);

  useEffect(() => {
    if (!permission) {
      log('CAMERA_PERMISSION_STATE', { permissionLoaded: false });
      return;
    }
    log('CAMERA_PERMISSION_STATE', {
      permissionLoaded: true,
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
      expires: permission.expires,
    });
  }, [permission]);

  const fetchStats = async () => {
    log('FETCH_STATS_START');
    try {
      const res = await api.get('/stats');
      setCheckInCount(res.data.checkInCount);
      log('FETCH_STATS_SUCCESS', { checkInCount: res.data.checkInCount });
    } catch (error: any) {
      log('FETCH_STATS_FAIL', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        data: error?.response?.data ?? null,
      });
    }
  };

  const handleAction = async (mobile: string, source: 'scan' | 'manual') => {
    const normalizedMobile = mobile.trim().replace(/\.0$/, '');
    if (!normalizedMobile) {
      log('ACTION_SKIPPED_EMPTY_MOBILE', { source, mobileInput: mobile });
      if (source === 'scan') {
        setScanned(false);
        scanLockRef.current = false;
        log('SCAN_LOCK_RELEASED', { reason: 'empty_mobile' });
      }
      return;
    }

    log('ACTION_START', { source, type: activeTab, mobile: normalizedMobile });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    try {
      const res = await api.post('/action', { mobile: normalizedMobile, type: activeTab });
      const { name, team_name, lab_no } = res.data;
      const nextMessage = team_name || 'Success!';
      const nextSubMessage = lab_no ? `Lab: ${lab_no} - ${name || ''}` : (name || '');
      
      log('ACTION_SUCCESS', {
        source,
        type: activeTab,
        mobile: normalizedMobile,
        name,
        team_name,
        lab_no: lab_no || '',
      });
      showOverlay('success', nextMessage, nextSubMessage);
      
      if (activeTab === 'register') fetchStats();
    } catch (error: any) {
      const nextSubMessage = error.response?.data?.error || error.message;
      log('ACTION_FAIL', {
        source,
        type: activeTab,
        mobile: normalizedMobile,
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        data: error?.response?.data ?? null,
      });
      showOverlay('error', 'Error!', nextSubMessage);
    }
  };

  const showOverlay = (
    nextType: 'success' | 'error',
    nextMessage: string,
    nextSubMessage: string
  ) => {
    setOverlayType(nextType);
    setOverlayMessage(nextMessage);
    setOverlaySubMessage(nextSubMessage);
    log('OVERLAY_SHOW', {
      overlayType: nextType,
      overlayMessage: nextMessage,
      overlaySubMessage: nextSubMessage,
    });
    setOverlayVisible(true);
    setTimeout(() => {
      setOverlayVisible(false);
      setScanned(false);
      log('OVERLAY_HIDE');
      scanLockRef.current = false;
      log('SCAN_LOCK_RELEASED', { reason: 'overlay_hide' });
    }, 2000);
  };

  const onBarcodeScanned = (barcode: { data: string }) => {
    log('BARCODE_SCANNED', {
      scanned,
      scanLock: scanLockRef.current,
      overlayVisible,
      rawData: barcode.data,
    });
    if (scanLockRef.current || scanned || overlayVisible) {
      log('BARCODE_IGNORED', {
        reason: scanLockRef.current
          ? 'scan_lock_active'
          : scanned
            ? 'already_processing'
            : 'overlay_visible',
      });
      return;
    }

    scanLockRef.current = true;
    log('SCAN_LOCK_SET');
    setScanned(true);
    handleAction(barcode.data, 'scan');
  };

  if (!permission) {
    log('CAMERA_PERMISSION_PENDING');
    return <View />;
  }
  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={{ textAlign: 'center' }}>We need your permission to show the camera</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            log('CAMERA_PERMISSION_REQUEST');
            requestPermission();
          }}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>Check-in Count: {checkInCount}</Text>
      </View>

      {/* Camera Full Screen */}
      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
      </View>

      {/* Bottom Controls */}
      <View style={styles.controlsContainer}>
        {/* Search Bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            placeholder="Manual Mobile Entry"
            value={mobileNum}
            onChangeText={(value) => {
              setMobileNum(value);
              log('MOBILE_INPUT_CHANGE', { value });
            }}
            keyboardType="phone-pad"
          />
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => {
              log('MANUAL_SUBMIT_CLICK', { mobileInput: mobileNum, type: activeTab });
              handleAction(mobileNum, 'manual');
            }}
          >
            <Text style={styles.buttonText}>Go</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabRow}>
          {(['register', 'redbull', 'dinner'] as ActionType[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.activeTabBtn]}
              onPress={() => {
                setActiveTab(tab);
                log('ACTION_TAB_CHANGE', { selected: tab });
              }}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Overlay Modal */}
      <Modal visible={overlayVisible} transparent animationType="fade">
        <View style={[styles.overlay, { backgroundColor: overlayType === 'success' ? '#2ecc71' : '#e74c3c' }]}>
          <Text style={styles.overlayText}>{overlayMessage}</Text>
          <Text style={styles.overlaySubText}>{overlaySubMessage}</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#000' },
  header: { paddingTop: 60, paddingBottom: 20, backgroundColor: '#333', alignItems: 'center' },
  headerText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  cameraContainer: { flex: 1 },
  controlsContainer: { backgroundColor: '#333', padding: 20, paddingBottom: 40 },
  searchRow: { flexDirection: 'row', marginBottom: 20 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 15, height: 50, fontSize: 16 },
  searchButton: { backgroundColor: '#3498db', justifyContent: 'center', alignItems: 'center', borderRadius: 8, paddingHorizontal: 20, marginLeft: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  tabRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tabBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: '#555', marginHorizontal: 5, borderRadius: 8 },
  activeTabBtn: { backgroundColor: '#f1c40f' },
  tabText: { color: '#ccc', fontWeight: 'bold' },
  activeTabText: { color: '#000' },
  button: { marginTop: 20, backgroundColor: '#3498db', padding: 15, borderRadius: 8 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  overlayText: { fontSize: 48, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 10 },
  overlaySubText: { fontSize: 24, color: '#fff', textAlign: 'center' },
});
