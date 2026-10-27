import { DEFAULT_ARITH_CONFIG } from '@/engine/arith/dot';
import type { LayerQuant, NetworkDef } from '@/engine/nn/network';
import { makeQuantConfig, type QuantConfig } from '@/engine/quant/types';
import { networkPreset, type NetworkPreset } from '@/data/networks';
import {
  SCHEMA_VERSION,
  defaultInspector,
  defaultMatrix,
  defaultWorkbench,
  type ExperimentState,
  type NetworkState,
  type NetworkVariant,
} from './schema';

export function weightConfig(partial: Partial<QuantConfig>): QuantConfig {
  return makeQuantConfig({ granularity: 'channel', axis: 0, ...partial });
}

export function activationConfig(partial: Partial<QuantConfig>): QuantConfig {
  return makeQuantConfig({ granularity: 'tensor', axis: 0, ...partial });
}

export function uniformLayers(net: NetworkDef, f: (i: number) => LayerQuant): LayerQuant[] {
  return net.layers.map((_, i) => f(i));
}

export function defaultNetworkVariants(net: NetworkDef): NetworkVariant[] {
  return [
    {
      id: 'n1',
      name: 'W8A8 INT8',
      enabled: true,
      layers: uniformLayers(net, () => ({ weight: weightConfig({ format: 'int8' }), activation: activationConfig({ format: 'int8' }), arith: null })),
      activationCalibration: 'dynamic',
    },
    {
      id: 'n2',
      name: 'INT4 weights (per-tensor)',
      enabled: true,
      layers: uniformLayers(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'tensor' }), activation: null, arith: null })),
      activationCalibration: 'dynamic',
    },
    {
      id: 'n3',
      name: 'FP8 E4M3 W+A',
      enabled: true,
      layers: uniformLayers(net, () => ({
        weight: weightConfig({ format: 'fp8_e4m3', granularity: 'tensor' }),
        activation: activationConfig({ format: 'fp8_e4m3' }),
        arith: null,
      })),
      activationCalibration: 'dynamic',
    },
  ];
}

export function networkStateFromPreset(preset: NetworkPreset): NetworkState {
  const network = structuredClone(preset.network);
  return {
    presetId: preset.id,
    network,
    samples: preset.samples.map((s) => [...s]),
    labels: preset.labels ? [...preset.labels] : null,
    selectedSample: 0,
    variants: defaultNetworkVariants(network),
    activeVariantId: 'n1',
    selection: null,
    showBoundary: !!preset.plotRange,
  };
}

export function defaultNetwork(): NetworkState {
  return networkStateFromPreset(networkPreset('moons'));
}

export function defaultExperimentState(): ExperimentState {
  return {
    schemaVersion: SCHEMA_VERSION,
    lab: 'inspector',
    inspector: defaultInspector(),
    workbench: defaultWorkbench(),
    matrix: defaultMatrix(),
    network: defaultNetwork(),
  };
}

export { DEFAULT_ARITH_CONFIG };
