package emailqueue

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

type fakeSQSAPI struct {
	sendInput    *sqs.SendMessageInput
	receiveInput *sqs.ReceiveMessageInput
	deleteInput  *sqs.DeleteMessageInput
	receiveOut   sqs.ReceiveMessageOutput
}

func (f *fakeSQSAPI) SendMessage(_ context.Context, input *sqs.SendMessageInput, _ ...func(*sqs.Options)) (*sqs.SendMessageOutput, error) {
	f.sendInput = input
	return &sqs.SendMessageOutput{}, nil
}

func (f *fakeSQSAPI) ReceiveMessage(_ context.Context, input *sqs.ReceiveMessageInput, _ ...func(*sqs.Options)) (*sqs.ReceiveMessageOutput, error) {
	f.receiveInput = input
	return &f.receiveOut, nil
}

func (f *fakeSQSAPI) DeleteMessage(_ context.Context, input *sqs.DeleteMessageInput, _ ...func(*sqs.Options)) (*sqs.DeleteMessageOutput, error) {
	f.deleteInput = input
	return &sqs.DeleteMessageOutput{}, nil
}

func TestMessageUsesExactPermanentConnectionGroupAndStableDeduplication(t *testing.T) {
	message := Message{
		SchemaVersion: SchemaVersion,
		Kind:          KindIngestion, JobID: "job-1", CompanyID: "company-1", EmailConnectionID: "connection-1",
	}
	if err := message.Validate(); err != nil {
		t.Fatal(err)
	}
	if got := message.GroupID(); got != "connection-1" {
		t.Fatalf("group = %q, want permanent connection ID", got)
	}
	if got, again := message.DeduplicationID(), message.DeduplicationID(); got == "" || got != again {
		t.Fatalf("dedup IDs are not stable: %q %q", got, again)
	}
	control := Message{SchemaVersion: SchemaVersion, Kind: KindReconciliationControl, ReconciliationID: "scan-1", ScanStartedAt: time.Now().UTC()}
	if got := control.GroupID(); got != ReconciliationControlGroup {
		t.Fatalf("control group = %q", got)
	}
}

func TestSQSSendsCompactFIFOMessageAndReceivesOneWithLongPolling(t *testing.T) {
	client := &fakeSQSAPI{}
	queue, err := newSQS(client, "https://sqs.example.test/work.fifo")
	if err != nil {
		t.Fatal(err)
	}
	message := Message{
		SchemaVersion: SchemaVersion,
		Kind:          KindArchiveItem, JobID: "item-1", CompanyID: "company-1", EmailConnectionID: "connection-1",
	}
	if err := queue.Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	if client.sendInput == nil || aws.ToString(client.sendInput.MessageGroupId) != "connection-1" || aws.ToString(client.sendInput.MessageDeduplicationId) != message.DeduplicationID() {
		t.Fatalf("send input = %+v", client.sendInput)
	}
	var decoded Message
	if err := json.Unmarshal([]byte(aws.ToString(client.sendInput.MessageBody)), &decoded); err != nil || decoded != message {
		t.Fatalf("compact body = %+v err=%v", decoded, err)
	}

	client.receiveOut.Messages = []types.Message{{
		Body: aws.String(aws.ToString(client.sendInput.MessageBody)), ReceiptHandle: aws.String("receipt-1"),
		Attributes: map[string]string{string(types.MessageSystemAttributeNameApproximateReceiveCount): "3"},
	}}
	delivery, ok, err := queue.Receive(context.Background())
	if err != nil || !ok || delivery.Message != message || delivery.ReceiveCount != 3 {
		t.Fatalf("delivery = %+v ok=%v err=%v", delivery, ok, err)
	}
	if client.receiveInput.MaxNumberOfMessages != 1 || client.receiveInput.WaitTimeSeconds != 20 {
		t.Fatalf("receive input = %+v", client.receiveInput)
	}
	if err := queue.Delete(context.Background(), delivery.ReceiptHandle); err != nil {
		t.Fatal(err)
	}
	if client.deleteInput == nil || aws.ToString(client.deleteInput.ReceiptHandle) != "receipt-1" {
		t.Fatalf("delete input = %+v", client.deleteInput)
	}
}
