import { config } from '@vue/test-utils';

// Charts render to <canvas>, which jsdom does not implement; component tests
// verify the option data instead (see tests/unit/charts.test.ts).
config.global.stubs = { EChart: { template: '<div class="echart-stub" />', props: ['option', 'label', 'height'] } };
