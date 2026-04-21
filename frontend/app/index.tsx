import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import axios from 'axios';

const configuredApiUrl = String(process.env.EXPO_PUBLIC_API_URL || '').trim();
const rawApiUrl = configuredApiUrl || (__DEV__ ? 'http://localhost:5000' : '');
const LOG_PREFIX = '[HackathonApp]';
const API_CONFIG_ERROR_MSG = 'API URL missing. Set EXPO_PUBLIC_API_URL and rebuild this app.';

function resolveApiUrl() {
  if (!rawApiUrl) {
    return '';
  }

  const normalizedFromEnv = /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `http://${rawApiUrl}`;
  const parsed = new URL(normalizedFromEnv);
  const envHost = parsed.hostname.toLowerCase();

  if (envHost !== 'localhost' && envHost !== '127.0.0.1') {
    return normalizedFromEnv;
  }

  const constantsData = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string };
  };

  const hostUri = constantsData.expoConfig?.hostUri || constantsData.manifest?.debuggerHost || '';
  const detectedHost = hostUri.split(':')[0];

  if (!detectedHost) {
    return normalizedFromEnv;
  }

  const port = parsed.port || '5000';
  return `${parsed.protocol}//${detectedHost}:${port}`;
}

const API_URL = resolveApiUrl();

const ASSETS = {
  acmLogo: require('../assets/images/acm-vit-logo.jpg'),
  throne: require('../assets/images/throne.jpeg'),
  mainThemeAlt: require('../assets/images/main theme 2 .png'),
};

const api = axios.create({
  baseURL: API_URL || undefined,
  timeout: 10000,
});

if (!API_URL) {
  console.error(`${LOG_PREFIX} API_URL_NOT_CONFIGURED`, {
    configuredApiUrl,
    hint: 'Set EXPO_PUBLIC_API_URL in EAS env for the active build profile and rebuild.',
  });
}

type ActionType = 'register' | 'redbull' | 'dinner';
type ScreenTab = 'scanner' | 'dashboard' | 'evaluation';
type OverlayType = 'success' | 'error';

type DashboardStats = {
  totalParticipants: number;
  registeredParticipants: number;
  remainingParticipants: number;
  dinnerTaken: number;
  dinnerPending: number;
  totalTeams: number;
  registeredTeams: number;
  remainingTeams: number;
};

type TeamDashboardRow = {
  team_name: string;
  lab_no: string;
  participant_count: number;
  registered_count: number;
  remaining_count: number;
  dinner_count: number;
  dinner_pending_count: number;
  team_registered: boolean;
};

type DashboardResponse = DashboardStats & {
  teams: TeamDashboardRow[];
  serverTime: string;
};

type EvaluationRow = {
  team_name: string;
  lab_no: string;
  participant_count: number;
  evaluation_1: number;
  evaluation_2: number;
  final_presentation: number;
  total: number;
  remarks: string;
  evaluated: boolean;
  evaluated_at: string | null;
  updatedAt: string | null;
};

type EvaluationsResponse = {
  count: number;
  evaluations: EvaluationRow[];
  serverTime: string;
};

const EMPTY_STATS: DashboardStats = {
  totalParticipants: 0,
  registeredParticipants: 0,
  remainingParticipants: 0,
  dinnerTaken: 0,
  dinnerPending: 0,
  totalTeams: 0,
  registeredTeams: 0,
  remainingTeams: 0,
};

const POLL_INTERVAL_MS = 5000;

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

function getErrorMessage(error: any): string {
  return String(error?.response?.data?.error || error?.message || 'Unexpected error');
}

function toScoreValue(value: string): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) {
    return 0;
  }
  return Math.round(score * 100) / 100;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [activeScreen, setActiveScreen] = useState<ScreenTab>('scanner');
  const [activeAction, setActiveAction] = useState<ActionType>('register');
  const [mobileNum, setMobileNum] = useState('');

  const [scanned, setScanned] = useState(false);
  const scanLockRef = useRef(false);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayType, setOverlayType] = useState<OverlayType>('success');
  const [overlayMessage, setOverlayMessage] = useState('');
  const [overlaySubMessage, setOverlaySubMessage] = useState('');

  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [teams, setTeams] = useState<TeamDashboardRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');

  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');
  const [evaluationSearch, setEvaluationSearch] = useState('');

  const [resultsUnlocked, setResultsUnlocked] = useState(false);
  const [techPassphrase, setTechPassphrase] = useState('');
  const [unlockInput, setUnlockInput] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const [formTeamName, setFormTeamName] = useState('');
  const [formLabNo, setFormLabNo] = useState('');
  const [formEvaluation1, setFormEvaluation1] = useState('0');
  const [formEvaluation2, setFormEvaluation2] = useState('0');
  const [formFinalPresentation, setFormFinalPresentation] = useState('0');
  const [formRemarks, setFormRemarks] = useState('');

  const showOverlay = useCallback((type: OverlayType, message: string, subMessage: string) => {
    setOverlayType(type);
    setOverlayMessage(message);
    setOverlaySubMessage(subMessage);
    setOverlayVisible(true);

    setTimeout(() => {
      setOverlayVisible(false);
      setScanned(false);
      scanLockRef.current = false;
    }, 2000);
  }, []);

  const hydrateEvaluationForm = useCallback((team: EvaluationRow) => {
    setFormTeamName(team.team_name);
    setFormLabNo(team.lab_no || '1000');
    setFormEvaluation1(String(team.evaluation_1 || 0));
    setFormEvaluation2(String(team.evaluation_2 || 0));
    setFormFinalPresentation(String(team.final_presentation || 0));
    setFormRemarks(team.remarks || '');
  }, []);

  const getTechHeaders = useCallback(
    (passphraseOverride?: string) => {
      const value = String(passphraseOverride || techPassphrase || '').trim();
      if (!value) {
        return {};
      }
      return { 'x-tech-passphrase': value };
    },
    [techPassphrase]
  );

  const fetchDashboard = useCallback(
    async (showLoader: boolean, passphraseOverride?: string) => {
      if (!API_URL) {
        setDashboardError(API_CONFIG_ERROR_MSG);
        return;
      }

      const headers = getTechHeaders(passphraseOverride);
      if (!headers['x-tech-passphrase']) {
        return;
      }

      if (showLoader) {
        setDashboardLoading(true);
      }

      try {
        const response = await api.get<DashboardResponse>('/dashboard', { headers });
        setStats({
          totalParticipants: response.data.totalParticipants,
          registeredParticipants: response.data.registeredParticipants,
          remainingParticipants: response.data.remainingParticipants,
          dinnerTaken: response.data.dinnerTaken,
          dinnerPending: response.data.dinnerPending,
          totalTeams: response.data.totalTeams,
          registeredTeams: response.data.registeredTeams,
          remainingTeams: response.data.remainingTeams,
        });
        setTeams(response.data.teams || []);
        setDashboardError('');
      } catch (error: any) {
        const message = getErrorMessage(error);
        if (error?.response?.status === 401) {
          setResultsUnlocked(false);
          setTechPassphrase('');
          setUnlockError('Passphrase required for Results/Evaluation');
          if (activeScreen !== 'scanner') {
            setActiveScreen('scanner');
          }
        }
        setDashboardError(message);
        log('FETCH_DASHBOARD_FAIL', { message });
      } finally {
        if (showLoader) {
          setDashboardLoading(false);
        }
      }
    },
    [activeScreen, getTechHeaders]
  );

  const fetchEvaluations = useCallback(
    async (showLoader: boolean, passphraseOverride?: string) => {
      if (!API_URL) {
        setEvaluationError(API_CONFIG_ERROR_MSG);
        return;
      }

      const headers = getTechHeaders(passphraseOverride);
      if (!headers['x-tech-passphrase']) {
        return;
      }

      if (showLoader) {
        setEvaluationLoading(true);
      }

      try {
        const response = await api.get<EvaluationsResponse>('/evaluations', { headers });
        const nextEvaluations = response.data.evaluations || [];
        setEvaluations(nextEvaluations);
        setEvaluationError('');

        if (!formTeamName && nextEvaluations.length > 0) {
          hydrateEvaluationForm(nextEvaluations[0]);
        }
      } catch (error: any) {
        const message = getErrorMessage(error);
        if (error?.response?.status === 401) {
          setResultsUnlocked(false);
          setTechPassphrase('');
          setUnlockError('Passphrase required for Results/Evaluation');
          if (activeScreen !== 'scanner') {
            setActiveScreen('scanner');
          }
        }
        setEvaluationError(message);
        log('FETCH_EVALUATIONS_FAIL', { message });
      } finally {
        if (showLoader) {
          setEvaluationLoading(false);
        }
      }
    },
    [activeScreen, formTeamName, getTechHeaders, hydrateEvaluationForm]
  );

  useEffect(() => {
    log('APP_MOUNT', { rawApiUrl, resolvedApiUrl: API_URL, apiConfigured: Boolean(API_URL) });
    return () => {
      log('APP_UNMOUNT');
    };
  }, []);

  useEffect(() => {
    if (!resultsUnlocked || !techPassphrase) {
      return;
    }

    void fetchDashboard(true);
    void fetchEvaluations(true);

    const dashboardTimer = setInterval(() => {
      void fetchDashboard(false);
    }, POLL_INTERVAL_MS);

    const evaluationTimer = setInterval(() => {
      void fetchEvaluations(false);
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(dashboardTimer);
      clearInterval(evaluationTimer);
    };
  }, [fetchDashboard, fetchEvaluations, resultsUnlocked, techPassphrase]);

  const handleAction = useCallback(
    async (mobile: string, source: 'scan' | 'manual') => {
      const normalizedMobile = mobile.trim().replace(/\.0$/, '');

      if (!normalizedMobile) {
        if (source === 'scan') {
          setScanned(false);
          scanLockRef.current = false;
        }
        return;
      }

      if (!API_URL) {
        showOverlay('error', 'API Not Configured', API_CONFIG_ERROR_MSG);
        if (source === 'scan') {
          setScanned(false);
          scanLockRef.current = false;
        }
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      try {
        const response = await api.post('/action', {
          mobile: normalizedMobile,
          type: activeAction,
        });

        const teamName = String(response.data?.team_name || 'Team N/A');
        const labNo = String(response.data?.lab_no || '1000');
        const name = String(response.data?.name || '');

        const statusMessage =
          activeAction === 'register'
            ? response.data?.alreadyRegistered
              ? 'Already Registered'
              : 'Registered'
            : activeAction === 'dinner'
              ? 'Dinner Marked'
              : 'Claimed';

        showOverlay(
          'success',
          statusMessage,
          `${teamName} | Lab: ${labNo}${name ? ` | ${name}` : ''}`
        );

        if (source === 'manual') {
          setMobileNum('');
        }

        if (resultsUnlocked) {
          void fetchDashboard(false);
        }
      } catch (error: any) {
        const message = getErrorMessage(error);
        showOverlay('error', 'Action Failed', message);
      }
    },
    [activeAction, fetchDashboard, resultsUnlocked, showOverlay]
  );

  const onBarcodeScanned = useCallback(
    (barcode: { data: string }) => {
      if (scanLockRef.current || scanned || overlayVisible) {
        return;
      }

      scanLockRef.current = true;
      setScanned(true);
      void handleAction(barcode.data, 'scan');
    },
    [handleAction, overlayVisible, scanned]
  );

  const unlockProtectedScreens = useCallback(async () => {
    if (!API_URL) {
      setUnlockError(API_CONFIG_ERROR_MSG);
      return;
    }

    const passphrase = unlockInput.trim();
    if (!passphrase) {
      setUnlockError('Enter passphrase first');
      return;
    }

    setUnlockLoading(true);
    try {
      await api.post('/tech/unlock', { passphrase });
      setTechPassphrase(passphrase);
      setResultsUnlocked(true);
      setUnlockError('');
      setDashboardError('');
      setEvaluationError('');
    } catch (error: any) {
      setUnlockError(getErrorMessage(error));
    } finally {
      setUnlockLoading(false);
    }
  }, [unlockInput]);

  const openExport = useCallback(
    async (path: string) => {
      if (!API_URL) {
        showOverlay('error', 'API Not Configured', API_CONFIG_ERROR_MSG);
        return;
      }

      if (!techPassphrase) {
        showOverlay('error', 'Locked', 'Unlock Results/Evaluation first');
        return;
      }

      const delimiter = path.includes('?') ? '&' : '?';
      const url = `${API_URL}${path}${delimiter}passphrase=${encodeURIComponent(techPassphrase)}`;
      try {
        await Linking.openURL(url);
        showOverlay('success', 'Export Opened', url);
      } catch {
        showOverlay('error', 'Export Failed', `Open manually: ${url}`);
      }
    },
    [showOverlay, techPassphrase]
  );

  const filteredEvaluations = useMemo(() => {
    const query = evaluationSearch.trim().toLowerCase();
    if (!query) {
      return evaluations;
    }

    return evaluations.filter((item) => {
      const team = item.team_name.toLowerCase();
      const lab = String(item.lab_no || '').toLowerCase();
      return team.includes(query) || lab.includes(query);
    });
  }, [evaluationSearch, evaluations]);

  const registeredTeamsOnly = useMemo(
    () => teams.filter((team) => team.registered_count > 0 || team.team_registered),
    [teams]
  );

  const selectedEvaluation = useMemo(
    () => evaluations.find((item) => item.team_name === formTeamName) || null,
    [evaluations, formTeamName]
  );

  const liveTotal = useMemo(
    () =>
      toScoreValue(formEvaluation1) + toScoreValue(formEvaluation2) + toScoreValue(formFinalPresentation),
    [formEvaluation1, formEvaluation2, formFinalPresentation]
  );

  const renderBrandCard = useCallback(
    (subtitle: string) => (
      <View style={styles.brandCard}>
        <Image source={ASSETS.acmLogo} style={styles.brandLogo} resizeMode="contain" />
        <View style={styles.brandCopy}>
          <Text style={styles.brandEyebrow}>ACM VIT </Text>
          <Text style={styles.brandTitle}>Breaking Enigma 4.0 Live</Text>
          <Text style={styles.brandSubtitle}>{subtitle}</Text>
        </View>
      </View>
    ),
    []
  );

  const renderMediaState = useCallback(
    (source: number, title: string, body: string) => (
      <View style={styles.mediaStateCard}>
        <Image source={source} style={styles.mediaStateArt} resizeMode="cover" />
        <View style={styles.mediaStateCopy}>
          <Text style={styles.mediaStateTitle}>{title}</Text>
          <Text style={styles.mediaStateBody}>{body}</Text>
        </View>
      </View>
    ),
    []
  );

  const saveEvaluation = useCallback(async () => {
    if (!API_URL) {
      showOverlay('error', 'API Not Configured', API_CONFIG_ERROR_MSG);
      return;
    }

    if (!formTeamName) {
      showOverlay('error', 'No Team Selected', 'Select a team before saving evaluation');
      return;
    }

    const headers = getTechHeaders();
    if (!headers['x-tech-passphrase']) {
      showOverlay('error', 'Locked', 'Unlock Results/Evaluation first');
      return;
    }

    try {
      await api.post(
        '/evaluations',
        {
          team_name: formTeamName,
          lab_no: formLabNo,
          evaluation_1: toScoreValue(formEvaluation1),
          evaluation_2: toScoreValue(formEvaluation2),
          final_presentation: toScoreValue(formFinalPresentation),
          remarks: formRemarks,
        },
        { headers }
      );

      showOverlay('success', 'Evaluation Saved', `${formTeamName} | Lab: ${formLabNo || '1000'}`);
      void fetchEvaluations(false);
    } catch (error: any) {
      showOverlay('error', 'Save Failed', getErrorMessage(error));
    }
  }, [
    fetchEvaluations,
    formEvaluation1,
    formEvaluation2,
    formFinalPresentation,
    formLabNo,
    formRemarks,
    formTeamName,
    getTechHeaders,
    showOverlay,
  ]);

  const renderProtectedLock = () => (
    <View style={styles.lockCard}>
      <Text style={styles.lockTitle}>Tech Team Unlock</Text>
      <Text style={styles.lockBody}>
        Results and Evaluation are password-protected for tech team members only.
      </Text>
      <TextInput
        style={styles.input}
        value={unlockInput}
        onChangeText={setUnlockInput}
        placeholder="Enter tech passphrase"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      {unlockError ? <Text style={styles.errorText}>{unlockError}</Text> : null}
      <TouchableOpacity
        style={[styles.primaryButton, unlockLoading && styles.primaryButtonDisabled]}
        onPress={() => void unlockProtectedScreens()}
        disabled={unlockLoading}
      >
        <Text style={styles.primaryButtonText}>{unlockLoading ? 'Unlocking...' : 'Unlock'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {renderBrandCard(
          resultsUnlocked
            ? `Teams ${stats.registeredTeams}/${stats.totalTeams} | Participants ${stats.registeredParticipants}/${stats.totalParticipants} | Dinner ${stats.dinnerTaken}/${stats.totalParticipants}`
            : 'Results and evaluation are locked until a tech passphrase is entered.'
        )}
      </View>

      <View style={styles.screenTabsRow}>
        {(['scanner', 'dashboard', 'evaluation'] as ScreenTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.screenTabBtn, activeScreen === tab && styles.screenTabBtnActive]}
            onPress={() => setActiveScreen(tab)}
          >
            <Text style={[styles.screenTabText, activeScreen === tab && styles.screenTabTextActive]}>
              {tab.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeScreen === 'scanner' && (
        <ScrollView style={styles.screenBody} contentContainerStyle={styles.screenScrollContent}>
          <View style={styles.cameraPanel}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFillObject}
                onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
              />
            ) : (
              <View style={styles.permissionCard}>
                <Text style={styles.permissionText}>Camera permission is needed only for QR scanning.</Text>
                <TouchableOpacity style={styles.primaryButton} onPress={() => requestPermission()}>
                  <Text style={styles.primaryButtonText}>Grant Camera Permission</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.controlsContainer}>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.input}
                placeholder="Manual mobile entry"
                value={mobileNum}
                onChangeText={setMobileNum}
                keyboardType="phone-pad"
              />
              <TouchableOpacity
                style={[styles.primaryButton, styles.searchButton]}
                onPress={() => void handleAction(mobileNum, 'manual')}
              >
                <Text style={styles.primaryButtonText}>Go</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.tabRow}>
              {(['register', 'redbull', 'dinner'] as ActionType[]).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tabBtn, activeAction === tab && styles.activeTabBtn]}
                  onPress={() => setActiveAction(tab)}
                >
                  <Text style={[styles.tabText, activeAction === tab && styles.activeTabText]}>{tab.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.noteText}>
               Use Register to mark registrationa and get lab number. Use Redbull and Dinner for one time Meal.
            </Text>
          </View>
        </ScrollView>
      )}

      {activeScreen === 'dashboard' &&
        (resultsUnlocked ? (
          <ScrollView style={styles.screenBody} contentContainerStyle={styles.dashboardContent}>
          {dashboardLoading && teams.length === 0 ? (
            <>
              {renderMediaState(
                ASSETS.throne,
                'Dashboard loading state',
                'Use this view to monitor teams, participants, and exports. The artwork only appears while the dashboard is fetching data.'
              )}
              <ActivityIndicator size="large" color="#f1c40f" />
            </>
          ) : null}
          {dashboardError ? <Text style={styles.errorText}>Dashboard error: {dashboardError}</Text> : null}

          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Registered Teams</Text>
              <Text style={styles.metricValue}>
                {stats.registeredTeams} / {stats.totalTeams}
              </Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Registered Participants</Text>
              <Text style={styles.metricValue}>
                {stats.registeredParticipants} / {stats.totalParticipants}
              </Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Participants Remaining</Text>
              <Text style={styles.metricValue}>{stats.remainingParticipants}</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Dinner Taken</Text>
              <Text style={styles.metricValue}>{stats.dinnerTaken}</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Dinner Pending</Text>
              <Text style={styles.metricValue}>{stats.dinnerPending}</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Teams Remaining</Text>
              <Text style={styles.metricValue}>{stats.remainingTeams}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Registered Teams ({registeredTeamsOnly.length})</Text>
          {registeredTeamsOnly.length === 0 ? (
            <Text style={styles.noteText}>No teams registered yet.</Text>
          ) : (
            registeredTeamsOnly.map((team) => (
              <View key={`registered-${team.team_name}-${team.lab_no}`} style={styles.registeredRow}>
                <Text style={styles.registeredName}>{team.team_name || 'Unassigned Team'}</Text>
                <Text style={styles.registeredMeta}>
                  Lab {team.lab_no || 'N/A'} | Registered {team.registered_count}/{team.participant_count}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>Exports</Text>
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/teams?format=csv')}
            >
              <Text style={styles.secondaryButtonText}>Teams CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/participants?format=csv')}
            >
              <Text style={styles.secondaryButtonText}>Participants CSV</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/teams?format=json')}
            >
              <Text style={styles.secondaryButtonText}>Teams JSON</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/participants?format=json')}
            >
              <Text style={styles.secondaryButtonText}>Participants JSON</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Team Live List ({teams.length})</Text>
          {teams.map((team) => (
            <View key={`${team.team_name}-${team.lab_no}`} style={styles.teamRow}>
              <View style={styles.teamRowTop}>
                <Text style={styles.teamName}>{team.team_name || 'Unassigned Team'}</Text>
                <Text style={styles.teamLab}>Lab {team.lab_no || 'N/A'}</Text>
              </View>
              <Text style={styles.teamMeta}>
                Registered {team.registered_count}/{team.participant_count} | Remaining {team.remaining_count}
              </Text>
              <Text style={styles.teamMeta}>
                Dinner {team.dinner_count}/{team.participant_count} | Pending {team.dinner_pending_count}
              </Text>
            </View>
          ))}
          </ScrollView>
        ) : (
          <View style={styles.screenBody}>{renderProtectedLock()}</View>
        ))}

      {activeScreen === 'evaluation' &&
        (resultsUnlocked ? (
          <ScrollView style={styles.screenBody} contentContainerStyle={styles.dashboardContent}>
          {evaluationLoading && evaluations.length === 0 ? (
            <>
              {renderMediaState(
                ASSETS.mainThemeAlt,
                'Evaluation loading state',
                'Search, review, and score teams here. The image stays compact so it supports the workflow instead of competing with it.'
              )}
              <ActivityIndicator size="large" color="#f1c40f" />
            </>
          ) : null}
          {evaluationError ? <Text style={styles.errorText}>Evaluation error: {evaluationError}</Text> : null}

          <Text style={styles.sectionTitle}>Evaluation Exports</Text>
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/evaluations?format=csv')}
            >
              <Text style={styles.secondaryButtonText}>Evaluation CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void openExport('/exports/evaluations?format=json')}
            >
              <Text style={styles.secondaryButtonText}>Evaluation JSON</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Search by team name or lab"
            value={evaluationSearch}
            onChangeText={setEvaluationSearch}
          />

          <ScrollView style={styles.teamPicker} nestedScrollEnabled>
            {filteredEvaluations.map((item) => (
              <TouchableOpacity
                key={item.team_name}
                style={[styles.teamPickRow, formTeamName === item.team_name && styles.teamPickRowActive]}
                onPress={() => hydrateEvaluationForm(item)}
              >
                <Text style={styles.teamPickName}>{item.team_name}</Text>
                <Text style={styles.teamPickMeta}>Lab {item.lab_no || 'N/A'} | Total {item.total.toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {selectedEvaluation ? (
            <View style={styles.evalFormCard}>
              <Text style={styles.evalFormTitle}>{formTeamName}</Text>
              <Text style={styles.evalFormSubtitle}>Lab {formLabNo || 'N/A'}</Text>

              <Text style={styles.fieldLabel}>Evaluation 1</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={formEvaluation1}
                onChangeText={setFormEvaluation1}
              />

              <Text style={styles.fieldLabel}>Evaluation 2</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={formEvaluation2}
                onChangeText={setFormEvaluation2}
              />

              <Text style={styles.fieldLabel}>Final Presentation</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={formFinalPresentation}
                onChangeText={setFormFinalPresentation}
              />

              <Text style={styles.fieldLabel}>Remarks</Text>
              <TextInput
                style={[styles.input, styles.remarksInput]}
                multiline
                value={formRemarks}
                onChangeText={setFormRemarks}
              />

              <Text style={styles.evalTotalText}>Live Total: {liveTotal.toFixed(2)}</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={() => void saveEvaluation()}>
                <Text style={styles.primaryButtonText}>Save Evaluation</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.noteText}>No team found. Check your registration import data.</Text>
          )}
          </ScrollView>
        ) : (
          <View style={styles.screenBody}>{renderProtectedLock()}</View>
        ))}

      <Modal visible={overlayVisible} transparent animationType="fade">
        <View style={[styles.overlay, overlayType === 'success' ? styles.overlaySuccess : styles.overlayError]}>
          <Text style={styles.overlayText}>{overlayMessage}</Text>
          <Text style={styles.overlaySubText}>{overlaySubMessage}</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0d14',
  },
  header: {
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: '#0a0d14',
  },
  brandCard: {
    minHeight: 96,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#131a28',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    marginRight: 12,
  },
  brandCopy: {
    flex: 1,
  },
  brandEyebrow: {
    color: '#f5d36a',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  brandTitle: {
    color: '#fff',
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900',
    marginTop: 2,
  },
  brandSubtitle: {
    color: '#d8e0ef',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
  },
  screenTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#101522',
  },
  screenTabBtn: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#1b2333',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  screenTabBtnActive: {
    backgroundColor: '#f5c84c',
  },
  screenTabText: {
    color: '#c8d0de',
    fontWeight: '700',
    fontSize: 12,
  },
  screenTabTextActive: {
    color: '#111827',
  },
  screenBody: {
    flex: 1,
  },
  screenScrollContent: {
    padding: 12,
    paddingBottom: 28,
  },
  cameraPanel: {
    height: 320,
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  permissionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#121827',
  },
  permissionText: {
    color: '#e4e8f1',
    textAlign: 'center',
    marginBottom: 16,
  },
  controlsContainer: {
    backgroundColor: '#121827',
    padding: 16,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#edf2f8',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    marginVertical: 6,
  },
  tabRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tabBtn: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#21293a',
    marginHorizontal: 4,
    borderRadius: 12,
  },
  activeTabBtn: {
    backgroundColor: '#f5c84c',
  },
  tabText: {
    color: '#d7deea',
    fontWeight: '700',
    fontSize: 12,
  },
  activeTabText: {
    color: '#111827',
  },
  noteText: {
    color: '#d8e0ef',
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
  },
  dashboardContent: {
    padding: 12,
    paddingBottom: 32,
  },
  mediaStateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#121827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  mediaStateArt: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#0c1018',
  },
  mediaStateCopy: {
    flex: 1,
  },
  mediaStateTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  mediaStateBody: {
    color: '#d8e0ef',
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  lockCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#121827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  lockTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  lockBody: {
    color: '#d8e0ef',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 10,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metricCard: {
    width: '48.5%',
    backgroundColor: '#121827',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  metricLabel: {
    color: '#ced7e6',
    fontSize: 12,
  },
  metricValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 8,
  },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#3d74ff',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  searchButton: {
    marginLeft: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#192234',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  secondaryButtonText: {
    color: '#f2f2f2',
    fontWeight: '600',
    fontSize: 12,
  },
  teamRow: {
    backgroundColor: '#121827',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  teamRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  teamName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  teamLab: {
    color: '#f1c40f',
    fontSize: 13,
    fontWeight: '700',
  },
  teamMeta: {
    color: '#c9c9c9',
    fontSize: 12,
    marginTop: 2,
  },
  registeredRow: {
    backgroundColor: '#13221b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d6b47',
    padding: 10,
    marginBottom: 8,
  },
  registeredName: {
    color: '#d6ffd6',
    fontSize: 14,
    fontWeight: '700',
  },
  registeredMeta: {
    color: '#b2e9b2',
    fontSize: 12,
    marginTop: 3,
  },
  teamPicker: {
    maxHeight: 220,
    backgroundColor: '#121827',
    borderRadius: 14,
    marginTop: 6,
  },
  teamPickRow: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  teamPickRowActive: {
    backgroundColor: '#1a2438',
  },
  teamPickName: {
    color: '#fff',
    fontWeight: '700',
  },
  teamPickMeta: {
    color: '#c7c7c7',
    fontSize: 12,
    marginTop: 3,
  },
  evalFormCard: {
    marginTop: 12,
    backgroundColor: '#121827',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  evalFormTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  evalFormSubtitle: {
    color: '#f1c40f',
    marginTop: 2,
    marginBottom: 8,
    fontWeight: '600',
  },
  fieldLabel: {
    color: '#d8e0ef',
    marginTop: 6,
    fontSize: 12,
  },
  remarksInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  evalTotalText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
  },
  errorText: {
    color: '#ff8f8f',
    marginBottom: 8,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  overlaySuccess: {
    backgroundColor: 'rgba(18, 86, 51, 0.95)',
  },
  overlayError: {
    backgroundColor: 'rgba(113, 27, 27, 0.95)',
  },
  overlayText: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  overlaySubText: {
    fontSize: 18,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 24,
  },
});
