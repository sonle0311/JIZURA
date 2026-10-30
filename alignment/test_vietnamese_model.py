"""Check the Vietnamese checkpoint projection without downloading weights."""
import importlib.util
import tempfile
import unittest

@unittest.skipUnless(importlib.util.find_spec('torch') and importlib.util.find_spec('transformers'), 'isolated alignment environment required')
class VietnameseModelTests(unittest.TestCase):
    def test_checkpoint_transform_is_loaded_and_used_for_ctc_projection(self):
        import torch
        from transformers import Wav2Vec2Config
        from alignment.vietnamese_model import VietnameseWav2Vec2ForCTC
        config=Wav2Vec2Config(hidden_size=8,num_hidden_layers=1,num_attention_heads=2,intermediate_size=16,
            conv_dim=(8,8,8),conv_stride=(5,2,2),conv_kernel=(10,3,3),num_conv_pos_embedding_groups=2,vocab_size=6)
        model=VietnameseWav2Vec2ForCTC(config).eval()
        with torch.no_grad():
            model.feature_transform.linear1.weight.fill_(.123)
        with tempfile.TemporaryDirectory() as directory:
            model.save_pretrained(directory)
            loaded,info=VietnameseWav2Vec2ForCTC.from_pretrained(directory,output_loading_info=True)
        self.assertEqual(info['missing_keys'],[])
        self.assertEqual(info['unexpected_keys'],[])
        self.assertTrue(torch.equal(loaded.feature_transform.linear1.weight,model.feature_transform.linear1.weight))
        inputs=torch.ones(1,3,8)
        captured=[]
        hook=loaded.feature_transform.register_forward_hook(lambda m,args,result:captured.append(result))
        with torch.no_grad():
            expected=torch.nn.functional.linear(loaded.feature_transform(inputs.reshape(-1,8)).reshape(1,3,8),loaded.lm_head.weight,loaded.lm_head.bias)
            actual=loaded.lm_head(inputs)
        self.assertTrue(torch.allclose(actual,expected))
        hook.remove()
        self.assertEqual(len(captured),2)
        self.assertEqual(tuple(captured[0].shape),(3,8))
