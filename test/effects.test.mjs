import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEffect, effectSvg } from '../public/effects.mjs';

test('photo overlays accept bounded positions and reject unsafe payloads', () => {
  const effect={width:800,height:600,faces:[{x:400,y:300,angle:12,length:60,extra:'discard'}]};
  assert.deepEqual(validateEffect(JSON.stringify(effect)).faces,[{x:400,y:300,angle:12,length:60}]);
  assert.equal(validateEffect(null),null);
  assert.equal(validateEffect({...effect,faces:[]}),null);
  for(const invalid of ['bad json',{...effect,width:2401},{...effect,faces:Array(51).fill(effect.faces[0])},{...effect,faces:[{x:0,y:0,angle:0,length:'<script>'}]},{...effect,faces:[{x:900,y:0,angle:0,length:60}]}]) {
    assert.throws(()=>validateEffect(invalid));
    assert.equal(effectSvg(invalid),'');
  }
  assert.match(effectSvg(effect),/viewBox="0 0 800 600"/);
});
