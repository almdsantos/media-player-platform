import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavBar from 'expo-navigation-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';

const BANNER_LATERAL = require('./assets/banner-lateral.png');
const BANNER_INFERIOR = require('./assets/banner-inferior.png');

const CONFIG_URI = FileSystem.documentDirectory + 'config.json';
const VIDEOS_DIR = FileSystem.documentDirectory + 'videos/';
// Links dos banners (edite aqui). Se o download falhar ou não houver internet,
// o app usa a última imagem baixada, ou os PNGs de assets/ se nunca baixou.
const BANNER_URLS = {
  lateral: 'https://raw.githubusercontent.com/almdsantos/media-player-platform/main/assets/banner-lateral.png',
  inferior: 'https://raw.githubusercontent.com/almdsantos/media-player-platform/main/assets/banner-inferior.png',
};
const BANNER_REFRESH_MS = 30 * 60 * 1000;
const BANNERS_JSON = FileSystem.documentDirectory + 'banners.json';

const MIN_SIDE_RATIO = 0.1;
const MAX_SIDE_RATIO = 0.2;
const MAX_BOTTOM_RATIO = 0.3;

function aspectOf(source, fallback) {
  const r = Image.resolveAssetSource(source);
  return r && r.width && r.height ? r.width / r.height : fallback;
}

async function loadConfig() {
  try {
    const info = await FileSystem.getInfoAsync(CONFIG_URI);
    if (!info.exists) return { pin: null, videos: [] };
    const cfg = JSON.parse(await FileSystem.readAsStringAsync(CONFIG_URI));
    return { pin: cfg.pin ?? null, videos: Array.isArray(cfg.videos) ? cfg.videos : [] };
  } catch {
    return { pin: null, videos: [] };
  }
}

async function saveConfig(cfg) {
  await FileSystem.writeAsStringAsync(CONFIG_URI, JSON.stringify(cfg));
}

function getSize(uri) {
  return new Promise((resolve, reject) =>
    Image.getSize(uri, (w, h) => resolve({ w, h }), reject)
  );
}

async function readBanners() {
  try {
    const info = await FileSystem.getInfoAsync(BANNERS_JSON);
    if (!info.exists) return {};
    const data = JSON.parse(await FileSystem.readAsStringAsync(BANNERS_JSON));
    const out = {};
    for (const k of Object.keys(BANNER_URLS)) {
      const b = data[k];
      if (b && b.uri) {
        const f = await FileSystem.getInfoAsync(b.uri);
        if (f.exists) out[k] = b;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function refreshBanner(key, current) {
  const tmp = FileSystem.documentDirectory + `banner-${key}-${Date.now()}.png`;
  try {
    const res = await FileSystem.downloadAsync(BANNER_URLS[key], tmp);
    if (res.status !== 200) throw new Error('http');
    const { w, h } = await getSize(tmp);
    const size = (await FileSystem.getInfoAsync(tmp)).size;
    if (current && current.size === size && current.w === w && current.h === h) {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
      return current;
    }
    if (current && current.uri) await FileSystem.deleteAsync(current.uri, { idempotent: true });
    return { uri: tmp, w, h, size };
  } catch {
    try {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {}
    return current || null;
  }
}

function numberOf(name) {
  const m = /\d+/.exec(name || '');
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

function sortAssets(assets) {
  return [...assets].sort((a, b) => {
    const na = numberOf(a.name);
    const nb = numberOf(b.name);
    if (na !== nb) return na < nb ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
  });
}

async function setImmersive(hidden) {
  try {
    if (NavBar.NavigationBar && NavBar.NavigationBar.setHidden) {
      NavBar.NavigationBar.setHidden(hidden);
    } else {
      await NavBar.setVisibilityAsync(hidden ? 'hidden' : 'visible');
    }
  } catch {}
}

function Player({ uris }) {
  const idx = useRef(0);
  const player = useVideoPlayer(uris[0], (p) => {
    p.loop = uris.length === 1;
    p.play();
  });

  const advance = useCallback(async () => {
    if (uris.length < 2) return;
    idx.current = (idx.current + 1) % uris.length;
    try {
      await player.replaceAsync(uris[idx.current]);
      player.play();
    } catch {}
  }, [player, uris]);

  useEventListener(player, 'playToEnd', advance);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error' && uris.length > 1) setTimeout(advance, 1500);
  });

  return (
    <VideoView
      player={player}
      style={styles.fill}
      nativeControls={false}
      contentFit="contain"
    />
  );
}

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <View style={styles.overlay}>
          <Text style={styles.error}>{String(this.state.err)}</Text>
          <Pressable style={styles.btn} onPress={this.props.onClose}>
            <Text style={styles.btnText}>Voltar</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function PinScreen({ pin, onSuccess, onCancel }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (value === pin) onSuccess();
    else {
      setError(true);
      setValue('');
    }
  };

  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>PIN</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(t) => {
          setError(false);
          setValue(t.replace(/\D/g, ''));
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={8}
        autoFocus
        onSubmitEditing={submit}
      />
      {error ? <Text style={styles.error}>PIN incorreto</Text> : null}
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={submit}>
          <Text style={styles.btnText}>Entrar</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnAlt]} onPress={onCancel}>
          <Text style={styles.btnText}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConfigScreen({ config, setConfig, immersive, setImmersiveState, onClose }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [newPin, setNewPin] = useState('');

  const pickVideos = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'video/mp4',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      setBusy(true);
      setMsg('Copiando vídeos…');
      await FileSystem.deleteAsync(VIDEOS_DIR, { idempotent: true });
      await FileSystem.makeDirectoryAsync(VIDEOS_DIR, { intermediates: true });
      const saved = [];
      const sorted = sortAssets(res.assets);
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const safe = (a.name || 'video.mp4').replace(/[^\w.\-]/g, '_');
        const dest = `${VIDEOS_DIR}${String(i).padStart(3, '0')}_${safe}`;
        await FileSystem.moveAsync({ from: a.uri, to: dest });
        saved.push(dest);
      }
      const next = { ...config, videos: saved };
      await saveConfig(next);
      setConfig(next);
      setMsg(`${saved.length} vídeo(s) salvo(s).`);
    } catch (e) {
      setMsg('Erro ao selecionar vídeos.');
    } finally {
      setBusy(false);
    }
  };

  const savePin = async () => {
    if (!/^\d{4,8}$/.test(newPin)) {
      setMsg('O PIN deve ter de 4 a 8 dígitos.');
      return;
    }
    const next = { ...config, pin: newPin };
    await saveConfig(next);
    setConfig(next);
    setNewPin('');
    setMsg('PIN salvo.');
  };

  return (
    <View style={styles.overlay}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.configContent}>
        <Text style={styles.title}>Configuração</Text>

        <Text style={styles.label}>
          Vídeos selecionados: {config.videos.length}
        </Text>
        {config.videos.map((v, i) => (
          <Text key={v} style={styles.item} numberOfLines={1}>
            {i + 1}. {decodeURIComponent(v.split('/').pop()).replace(/^\d+_/, '')}
          </Text>
        ))}
        <Pressable style={styles.btn} onPress={pickVideos} disabled={busy}>
          <Text style={styles.btnText}>Selecionar vídeos (MP4)</Text>
        </Pressable>

        <Text style={[styles.label, styles.gap]}>
          {config.pin ? 'Alterar PIN (4 a 8 dígitos)' : 'Definir PIN (4 a 8 dígitos)'}
        </Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.pinInput]}
            value={newPin}
            onChangeText={(t) => setNewPin(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
          />
          <Pressable style={styles.btn} onPress={savePin}>
            <Text style={styles.btnText}>Salvar PIN</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.btn, styles.btnAlt, styles.gap]} onPress={() => setImmersiveState(!immersive)}>
          <Text style={styles.btnText}>
            {immersive ? 'Sair do modo tela cheia' : 'Voltar ao modo tela cheia'}
          </Text>
        </Pressable>

        {busy ? <ActivityIndicator color="#b6ff00" style={styles.gap} /> : null}
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        <Pressable style={[styles.btn, styles.gap]} onPress={onClose} disabled={busy}>
          <Text style={styles.btnText}>Concluir</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export default function App() {
  const { width, height } = useWindowDimensions();
  const [config, setConfig] = useState(null);
  const [screen, setScreen] = useState('player'); // player | pin | config
  const [immersive, setImmersiveState] = useState(true);
  const cornerTimer = useRef(null);
  const hideTimer = useRef(null);
  const [showBtn, setShowBtn] = useState(false);
  const [remote, setRemote] = useState({});
  const remoteRef = useRef({});

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const next = {};
      for (const k of Object.keys(BANNER_URLS)) {
        const b = await refreshBanner(k, remoteRef.current[k]);
        if (b) next[k] = b;
      }
      remoteRef.current = next;
      if (alive) setRemote(next);
      try {
        await FileSystem.writeAsStringAsync(BANNERS_JSON, JSON.stringify(next));
      } catch {}
    };
    readBanners().then((cached) => {
      remoteRef.current = cached;
      if (alive) setRemote(cached);
      run();
    });
    const t = setInterval(run, BANNER_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    setImmersive(immersive);
  }, [immersive, screen]);

  const openConfig = () => {
    if (config && config.pin) setScreen('pin');
    else setScreen('config');
  };

  const closeConfig = () => {
    setImmersiveState(true);
    setScreen('player');
  };

  const startCorner = () => {
    clearTimeout(cornerTimer.current);
    cornerTimer.current = setTimeout(openConfig, 1200);
  };
  const cancelCorner = () => clearTimeout(cornerTimer.current);
  const revealBtn = () => {
    setShowBtn(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBtn(false), 4000);
  };

  if (!config) return <View style={styles.root} />;

  if (screen !== 'player') {
    return (
      <View style={styles.root}>
        <StatusBar hidden={immersive} />
        <Boundary onClose={closeConfig}>
          {screen === 'pin' ? (
            <PinScreen
              pin={config.pin}
              onSuccess={() => setScreen('config')}
              onCancel={() => setScreen('player')}
            />
          ) : (
            <ConfigScreen
              config={config}
              setConfig={setConfig}
              immersive={immersive}
              setImmersiveState={setImmersiveState}
              onClose={closeConfig}
            />
          )}
        </Boundary>
      </View>
    );
  }

  // Cada banner mantém a proporção do seu PNG e preenche toda a sua área.
  const latSrc = remote.lateral ? { uri: remote.lateral.uri } : BANNER_LATERAL;
  const infSrc = remote.inferior ? { uri: remote.inferior.uri } : BANNER_INFERIOR;
  const latAspect = remote.lateral
    ? remote.lateral.w / remote.lateral.h
    : aspectOf(BANNER_LATERAL, 0.24);
  const infAspect = remote.inferior
    ? remote.inferior.w / remote.inferior.h
    : aspectOf(BANNER_INFERIOR, 5.8);
  const sideW = Math.round(
    Math.min(
      Math.max(height * latAspect, width * MIN_SIDE_RATIO),
      width * MAX_SIDE_RATIO
    )
  );
  const leftW = width - sideW;
  const bottomH = Math.round(
    Math.min(leftW / infAspect, height * MAX_BOTTOM_RATIO)
  );

  return (
    <View style={styles.root} onTouchStart={revealBtn}>
      <StatusBar hidden={immersive} />

      <View style={{ width: leftW, height }}>
        <View style={styles.fill}>
          {config.videos.length > 0 ? (
            <Player key={config.videos.join('|')} uris={config.videos} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Nenhum vídeo configurado{'\n'}Segure o canto superior direito para configurar
              </Text>
            </View>
          )}
        </View>
        <Image
          source={infSrc}
          style={{ width: leftW, height: bottomH }}
          resizeMode="contain"
        />
      </View>

      <View style={{ width: sideW, height }}>
        <Image source={latSrc} style={styles.fill} resizeMode="contain" />
      </View>

      {screen === 'player' ? (
        <View
          style={styles.corner}
          onTouchStart={startCorner}
          onTouchEnd={cancelCorner}
          onTouchCancel={cancelCorner}
        >
          <Pressable
            style={styles.fill0}
            delayLongPress={1200}
            onLongPress={openConfig}
          />
        </View>
      ) : null}

      {screen === 'player' && showBtn ? (
        <Pressable
          style={[styles.cfgBtn, { right: sideW + 24 }]}
          onPress={() => {
            setShowBtn(false);
            openConfig();
          }}
        >
          <Text style={styles.cfgBtnText}>Configurações</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center' },
  corner: {
    position: 'absolute',
    top: 36,
    right: 36,
    width: 220,
    height: 220,
    zIndex: 999,
    elevation: 999,
  },
  fill0: { flex: 1 },
  cfgBtn: {
    position: 'absolute',
    top: 36,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  cfgBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1, alignSelf: 'stretch' },
  configContent: { flexGrow: 1, justifyContent: 'center', padding: 32, alignItems: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', marginBottom: 16 },
  label: { color: '#ddd', fontSize: 16, marginBottom: 8 },
  item: { color: '#999', fontSize: 13, maxWidth: 520 },
  gap: { marginTop: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    fontSize: 20,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 160,
    textAlign: 'center',
  },
  pinInput: { marginTop: 0 },
  btn: {
    backgroundColor: '#3d6b00',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 12,
  },
  btnAlt: { backgroundColor: '#333' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#ff6b6b', marginTop: 8 },
  msg: { color: '#b6ff00', marginTop: 12 },
});
